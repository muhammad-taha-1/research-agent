import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AgentRole } from "@/generated/prisma/enums";
import type { AgentMemory } from "./memory";

// The loop calls client.beta.messages (for context editing), so use the beta tool type
export type ToolDefinition = Anthropic.Beta.BetaTool;

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

export interface AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  definition: ToolDefinition;
  inputSchema: S; // validated in registry.execute — a bad input becomes an error result, not a crash
  execute: (input: z.infer<S>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  projectId: string;
  runId: string;
  userId: string;
}

/** Identity helper so `execute` gets its input type inferred from `inputSchema`. */
export function defineTool<S extends z.ZodTypeAny>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

export function ok(data: unknown): ToolResult {
  return { success: true, data };
}

export function fail(error: string): ToolResult {
  return { success: false, data: null, error };
}

// === The agent loop ===

export interface AgentConfig {
  role: AgentRole;
  model: string;
  systemPrompt: string; // keep it identical across requests: no timestamps (cache!)
  tools: ToolDefinition[];
  maxSteps: number; // max tool calls per run (safety limit)
  maxTokensPerStep: number; // max_tokens per model call; thinking counts toward it
  maxCostUsd: number;
  maxDurationMs: number;
  // evaluate_progress can't end the run before this much work is done (limits still can)
  minimumWork?: { searches: number; pagesRead: number };
}

export interface AgentState {
  projectId: string;
  runId: string;
  userId: string;
  messages: Anthropic.Beta.BetaMessageParam[]; // the append-only conversation
  memory: AgentMemory; // structured copy of what's been done and learned
  stepNumber: number; // timeline numbering (thinking steps + tool steps)
  toolCalls: number; // counts toward maxSteps
  costUsd: number;
  startedAt: number;
  consecutiveErrors: number;
  doneRequested: boolean; // set when evaluate_progress says should_continue: false
}

export type RunOutcome = "COMPLETED" | "LIMIT_REACHED" | "PAUSED" | "STOPPED" | "ERROR";

export interface ResearchPlan {
  completed: string[];
  inProgress: string;
  remaining: string[];
  gaps: string[];
}

// What the agent emits for each step (sent to the UI through the event bus).
// No event is called `error`: EventSource uses that name for connection failures.
// `agent_done` is one agent finishing; `done` is the whole project finishing.
export type AgentEventType =
  | "thinking"
  | "tool_call"
  | "step_complete"
  | "finding"
  | "plan_update"
  | "status_change"
  | "redirect_applied"
  | "review"
  | "report_chunk"
  | "usage"
  | "agent_error"
  | "agent_done"
  | "done";

export interface AgentEvent {
  type: AgentEventType;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- payload depends on type
  timestamp: string; // ISO string, since it goes through JSON anyway
}

export type EmitFn = (event: AgentEvent) => Promise<void>;
