import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@/generated/prisma/client";
import type { RunStatus, StepStatus, StepType } from "@/generated/prisma/enums";
import { AGENT_BETAS, anthropic } from "@/lib/ai/anthropic";
import { calculateCost } from "@/lib/ai/pricing";
import { readControlSignals, takeRedirects } from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { toStepView, toUsageView } from "@/lib/research/queries";
import type { ToolRegistry } from "@/lib/tools/registry";
import { MAX_CONSECUTIVE_ERRORS } from "./limits";
import type {
  AgentConfig,
  AgentEvent,
  AgentEventType,
  AgentState,
  EmitFn,
  RunOutcome,
  ToolResult,
} from "./types";

// The ReAct loop: THINK (ask Claude) → ACT (run its tool calls) → OBSERVE (append
// the results) → DECIDE (limits, errors, done) — until Claude stops calling tools
// or a limit or human control ends the run.
//
// The conversation in state.messages is append-only: the whole assistant turn goes
// in as returned, all tool results go back in one user message, and earlier turns
// are never edited. That keeps the prompt cache and Claude's earlier reasoning valid.

// Once a request passes ~60K input tokens, the API replaces the oldest tool
// results with a placeholder before Claude sees them, keeping the 4 most recent.
// Tool INPUTS stay, so Claude still sees which queries it ran and which URLs it read.
// Findings, plan, and evaluations are never cleared: they're the agent's notes.
// Server-side, so our array (and the cache) is untouched.
const CLEAR_OLD_TOOL_RESULTS: Anthropic.Beta.BetaClearToolUses20250919Edit = {
  type: "clear_tool_uses_20250919",
  trigger: { type: "input_tokens", value: 60_000 },
  keep: { type: "tool_uses", value: 4 },
  clear_at_least: { type: "input_tokens", value: 20_000 }, // clear in big batches: each clear costs one cache rewrite
  exclude_tools: ["save_finding", "update_plan", "evaluate_progress"],
};

const TOOL_STEP_TYPES: Record<string, StepType> = {
  web_search: "SEARCH",
  read_webpage: "READ",
  save_finding: "NOTE",
  update_plan: "PLAN",
  evaluate_progress: "EVALUATE",
};

const RUN_STATUS: Record<Exclude<RunOutcome, "PAUSED">, RunStatus> = {
  COMPLETED: "COMPLETED",
  LIMIT_REACHED: "COMPLETED", // stopped gracefully; what was found is kept
  STOPPED: "STOPPED",
  ERROR: "ERROR",
};

interface RunContext {
  config: AgentConfig;
  state: AgentState;
  tools: ToolRegistry;
  emit: EmitFn;
  // This turn's token usage, attached to the first step saved after the model call
  pendingUsage: { inputTokens: number; outputTokens: number } | null;
}

interface StepInput {
  stepNumber?: number;
  type: StepType;
  reasoning?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  duration?: number;
  status?: StepStatus;
  error?: string;
}

export function event(type: AgentEventType, data: unknown): AgentEvent {
  return { type, data, timestamp: new Date().toISOString() };
}

export async function runAgentLoop(
  config: AgentConfig,
  state: AgentState,
  tools: ToolRegistry,
  emit: EmitFn,
): Promise<RunOutcome> {
  const ctx: RunContext = { config, state, tools, emit, pendingUsage: null };

  while (true) {
    // ---- Step boundary: limits and human controls ----
    if (state.toolCalls >= config.maxSteps) return endRun(ctx, "LIMIT_REACHED", "max_steps");
    if (state.costUsd >= config.maxCostUsd) return endRun(ctx, "LIMIT_REACHED", "budget");
    if (Date.now() - state.startedAt >= config.maxDurationMs) return endRun(ctx, "LIMIT_REACHED", "timeout");

    const signals = await readControlSignals(state.projectId);
    if (signals.stop) return endRun(ctx, "STOPPED", "user_stop");
    if (signals.pause) {
      await checkpoint(ctx); // pending redirects stay queued until resume
      return "PAUSED";
    }
    const redirects = await takeRedirects(state.projectId); // reads AND clears the queue
    if (redirects.length > 0) {
      // A mid-conversation system message: it carries operator authority,
      // doesn't edit history, and keeps the cache valid.
      state.messages.push({
        role: "system",
        content: `New instruction from the user:\n${redirects.join("\n")}\nAdjust your plan accordingly.`,
      });
      await saveAndEmitStep(ctx, { type: "REDIRECT", reasoning: redirects.join("\n") });
      await emit(event("redirect_applied", { instructions: redirects }));
    }

    // ---- THINK: ask Claude for the next move ----
    await emit(event("thinking", { stepNumber: state.stepNumber + 1 }));

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await anthropic.beta.messages.create({
        model: config.model,
        max_tokens: config.maxTokensPerStep,
        betas: AGENT_BETAS,
        fallbacks: "default",
        system: config.systemPrompt,
        tools: config.tools,
        messages: state.messages,
        thinking: { type: "adaptive", display: "summarized" }, // the default display is empty; we want to show it
        output_config: { effort: "medium" }, // a good start for multi-step tool use; tune in Phase 7
        cache_control: { type: "ephemeral" }, // cache everything up to the newest message
        context_management: { edits: [CLEAR_OLD_TOOL_RESULTS] },
      });
    } catch (error) {
      // The SDK already retried 429/5xx; what's left won't fix itself by looping
      if (error instanceof Anthropic.APIError) return endRun(ctx, "ERROR", "api_error", error.message);
      throw error;
    }

    await recordUsage(ctx, response);

    // ---- OBSERVE: put the reasoning on the timeline ----
    for (const block of response.content) {
      const reasoning =
        block.type === "thinking" ? block.thinking : block.type === "text" ? block.text : null;
      if (reasoning?.trim()) await saveAndEmitStep(ctx, { type: "THINK", reasoning });
    }

    // ---- Stop reasons to handle BEFORE running anything ----
    if (response.stop_reason === "refusal") {
      return endRun(ctx, "ERROR", "refusal", response.stop_details?.explanation ?? undefined);
    }
    if (response.stop_reason === "max_tokens") {
      // A tool_use cut off mid-input must not run or be appended (it would never
      // get a tool_result). If you see this, raise maxTokensPerStep.
      return endRun(ctx, "ERROR", "max_tokens");
    }

    state.messages.push({ role: "assistant", content: response.content }); // the WHOLE turn

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) {
      // Claude ended its turn without calling a tool, so it considers itself done
      await checkpoint(ctx);
      return endRun(ctx, "COMPLETED", "agent_done");
    }

    // ---- ACT: run every tool call from this turn, in parallel ----
    const results = await Promise.all(toolUses.map((call) => runToolCall(ctx, call)));
    state.messages.push({ role: "user", content: results }); // ALL results in ONE message

    // ---- DECIDE ----
    // Tool results are appended even when evaluate_progress says stop, so the saved
    // conversation never ends on an unanswered tool call and can always be resumed.
    state.consecutiveErrors = results.every((r) => r.is_error) ? state.consecutiveErrors + 1 : 0;
    await checkpoint(ctx);

    if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      return endRun(ctx, "ERROR", "consecutive_errors");
    }
    if (state.doneRequested) return endRun(ctx, "COMPLETED", "agent_done");
  }
}

/** One tool call = one timeline step. Never throws: failures become error results. */
async function runToolCall(
  ctx: RunContext,
  call: Anthropic.Beta.BetaToolUseBlock,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const { state, tools, emit } = ctx;
  const stepNumber = ++state.stepNumber;
  state.toolCalls++;
  const started = Date.now();
  await emit(event("tool_call", { stepNumber, tool: call.name, input: call.input }));

  let result: ToolResult =
    state.memory.checkDuplicate(call.name, call.input) ??
    (await tools.execute(call.name, call.input, {
      projectId: state.projectId,
      runId: state.runId,
      userId: state.userId,
    }));

  state.memory.record(call.name, call.input, result);
  if (
    call.name === "evaluate_progress" &&
    result.success &&
    (call.input as { should_continue?: boolean }).should_continue === false
  ) {
    const missing = missingWork(ctx);
    if (missing) {
      result = { ...result, data: { ...(result.data as object), stop_refused: true, next: missing } };
    } else {
      state.doneRequested = true;
    }
  }

  await saveAndEmitStep(ctx, {
    stepNumber,
    type: TOOL_STEP_TYPES[call.name] ?? "THINK",
    toolName: call.name,
    toolInput: call.input,
    toolResult: result,
    duration: Date.now() - started,
    status: result.success ? "COMPLETED" : "ERROR",
    error: result.error,
  });
  if (call.name === "save_finding" && result.success) await emit(event("finding", result.data));
  if (call.name === "update_plan" && result.success) await emit(event("plan_update", result.data));

  return {
    type: "tool_result",
    tool_use_id: call.id,
    content: JSON.stringify(result.success ? result.data : { error: result.error }),
    is_error: !result.success,
  };
}

/** Why the agent can't stop yet, or null once its minimum work is done. */
function missingWork({ config, state }: RunContext): string | null {
  const min = config.minimumWork;
  if (!min) return null;
  const { searchCount, pagesRead } = state.memory;
  if (searchCount >= min.searches && pagesRead >= min.pagesRead) return null;
  return (
    `Not done yet: this depth needs at least ${min.searches} searches and ${min.pagesRead} page reads, ` +
    `and you've done ${searchCount} and ${pagesRead}. Keep researching: fill your plan's gaps and ` +
    `cross-check key claims against more sources.`
  );
}

/** Strips undefined and anything else JSON can't hold, so Prisma accepts it. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}

/** Writes an AgentStep row and emits it as `step_complete`. */
async function saveAndEmitStep(ctx: RunContext, step: StepInput): Promise<void> {
  const usage = ctx.pendingUsage;
  ctx.pendingUsage = null;

  const row = await prisma.agentStep.create({
    data: {
      runId: ctx.state.runId,
      stepNumber: step.stepNumber ?? ++ctx.state.stepNumber,
      type: step.type,
      reasoning: step.reasoning,
      toolName: step.toolName,
      toolInput: toJson(step.toolInput),
      toolResult: toJson(step.toolResult),
      duration: step.duration,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      status: step.status ?? "COMPLETED",
      error: step.error,
    },
  });
  await ctx.emit(event("step_complete", toStepView(row, ctx.config.role)));
}

/** Adds one model call's tokens and cost to the run, and emits the run's new totals. */
async function recordUsage(ctx: RunContext, response: Anthropic.Beta.BetaMessage): Promise<void> {
  const { usage } = response;
  const cost = calculateCost(response.model, usage);
  ctx.state.costUsd += cost;

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  ctx.pendingUsage = {
    inputTokens: usage.input_tokens + cacheRead + cacheWrite, // the whole prompt, cached or not
    outputTokens: usage.output_tokens,
  };

  const run = await prisma.agentRun.update({
    where: { id: ctx.state.runId },
    data: {
      totalInputTokens: { increment: usage.input_tokens },
      totalOutputTokens: { increment: usage.output_tokens },
      totalCacheReadTokens: { increment: cacheRead },
      totalCacheWriteTokens: { increment: cacheWrite },
      costUsd: { increment: cost },
    },
  });
  await ctx.emit(event("usage", { runId: run.id, ...toUsageView(run) }));
}

/** Persists the conversation and memory so the run can resume after a pause or crash. */
async function checkpoint({ state }: RunContext): Promise<void> {
  await prisma.agentRun.update({
    where: { id: state.runId },
    data: {
      // Stored exactly as the API returned it (thinking blocks included) and sent back unchanged
      messages: state.messages as unknown as Prisma.InputJsonValue,
      memory: toJson(state.memory.toJSON()),
      totalSearches: state.memory.searchCount,
      totalPagesRead: state.memory.pagesRead,
    },
  });
}

async function endRun(
  ctx: RunContext,
  outcome: Exclude<RunOutcome, "PAUSED">,
  reason: string,
  error?: string,
): Promise<RunOutcome> {
  const { state, config, emit } = ctx;
  await prisma.agentRun.update({
    where: { id: state.runId },
    data: {
      status: RUN_STATUS[outcome],
      endReason: reason,
      error: error ?? null,
      completedAt: new Date(),
    },
  });

  const data = { runId: state.runId, role: config.role, outcome, reason, error };
  await emit(event(outcome === "ERROR" ? "agent_error" : "agent_done", data));
  return outcome;
}
