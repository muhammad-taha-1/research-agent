import type { AgentStep } from "@/generated/prisma/client";
import type { AgentRole, ErrorType } from "@/generated/prisma/enums";

// One JSON line per agent action on stdout (the worker's console), for tuning prompts:
//   npm run worker | grep '"agent"' | jq 'select(.type == "SEARCH")'
// AGENT_LOG=off silences it; AGENT_LOG=full logs tool inputs/results/reasoning uncut.

export interface AgentAction {
  projectId: string;
  runId: string;
  agent: AgentRole;
  round: number;
  step?: number;
  type: string; // a StepType, or RUN_END
  status?: string;
  reasoning?: string;
  tool?: string;
  input?: unknown;
  result?: unknown;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd?: number;
  model?: string;
  duration?: number; // ms the tool call took
  modelDuration?: number; // ms the model call took
  error?: string;
  errorType?: ErrorType;
  endReason?: string;
}

const PREVIEW_CHARS = 300;

function mode(): "off" | "full" | "compact" {
  const v = process.env.AGENT_LOG?.toLowerCase();
  return v === "off" || v === "0" || v === "false" ? "off" : v === "full" ? "full" : "compact";
}

/** Long values are clipped to a preview in compact mode so a line stays readable. */
function clip(value: unknown, full: boolean): unknown {
  if (value === undefined || value === null || full) return value ?? undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= PREVIEW_CHARS) return value;
  return `${text.slice(0, PREVIEW_CHARS)}… (+${text.length - PREVIEW_CHARS} chars)`;
}

export function logAgentAction(action: AgentAction): void {
  const m = mode();
  if (m === "off") return;
  const full = m === "full";
  try {
    const line = {
      timestamp: new Date().toISOString(),
      ...action,
      reasoning: clip(action.reasoning, full),
      input: clip(action.input, full),
      result: clip(action.result, full),
    };
    console.log(JSON.stringify(line, (_k, v) => (v === null ? undefined : v)));
  } catch {
    // Logging must never break a run
  }
}

/** Logs a saved step row. */
export function logStep(
  step: AgentStep,
  run: { projectId: string; agentRole: AgentRole; round: number },
): void {
  logAgentAction({
    projectId: run.projectId,
    runId: step.runId,
    agent: run.agentRole,
    round: run.round,
    step: step.stepNumber,
    type: step.type,
    status: step.status,
    reasoning: step.reasoning ?? undefined,
    tool: step.toolName ?? undefined,
    input: step.toolInput ?? undefined,
    // A failed tool's error is logged on its own; the result would only repeat it
    result: step.status === "ERROR" ? undefined : (step.toolResult ?? undefined),
    tokens:
      step.inputTokens != null || step.outputTokens != null
        ? {
            input: step.inputTokens ?? 0,
            output: step.outputTokens ?? 0,
            cacheRead: step.cacheReadTokens ?? 0,
            cacheWrite: step.cacheWriteTokens ?? 0,
          }
        : undefined,
    costUsd: step.costUsd ?? undefined,
    model: step.model ?? undefined,
    duration: step.duration ?? undefined,
    modelDuration: step.modelDuration ?? undefined,
    error: step.error ?? undefined,
    errorType: step.errorType ?? undefined,
  });
}
