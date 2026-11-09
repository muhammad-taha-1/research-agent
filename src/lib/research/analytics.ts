import type { ErrorType } from "@/generated/prisma/enums";
import type { AgentStepView, RunSummaryView } from "@/types/research";

// Numbers for the analytics tab and the run debugger, computed from steps on the
// client so they stay live as steps stream in. Client-safe: no Prisma here.

export type ErrorKey = ErrorType | "OTHER";

export const ERROR_META: Record<ErrorKey, { label: string; hint: string }> = {
  NETWORK_ERROR: { label: "Network", hint: "Timeouts, DNS or connection failures, 5xx from a site" },
  RATE_LIMIT: { label: "Rate limit", hint: "429s from the API, a site, or the search provider" },
  PARSE_ERROR: { label: "Parse error", hint: "Invalid tool input, or output that didn't parse" },
  CONTEXT_OVERFLOW: { label: "Context overflow", hint: "The prompt outgrew the context window" },
  TOOL_ERROR: { label: "Tool error", hint: "404s, PDFs, pages with no readable text, …" },
  URL_BLOCKED: { label: "URL blocked", hint: "The URL guard refused it, or the site refused us (401/403/451)" },
  REFUSAL: { label: "Refusal", hint: "The model declined" },
  MAX_TOKENS: { label: "Max tokens", hint: "A response hit max_tokens" },
  API_ERROR: { label: "API error", hint: "Any other Claude API error (overloaded, invalid request, …)" },
  OTHER: { label: "Other", hint: "Uncategorized: worker crashes, interrupted runs, older data" },
};

/** How long a step took: its tool call, or for a step without one, its model call. */
export const stepTime = (s: AgentStepView): number | null => s.duration ?? s.modelDuration ?? null;

/** A step that carries a model call's usage (the first step of each turn). */
export const isTurn = (s: AgentStepView): boolean => s.costUsd != null;

export const turnTokens = (s: AgentStepView): number => (s.inputTokens ?? 0) + (s.outputTokens ?? 0);

export interface TurnStats {
  turns: number;
  costUsd: number;
  avgCostUsd: number | null;
  last: AgentStepView | null;
  cacheHitRate: number | null; // cache reads / the whole prompt, over every turn
  avgModelMs: number | null;
}

export function turnStats(steps: AgentStepView[]): TurnStats {
  const turns = steps.filter(isTurn);
  const costUsd = turns.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  const prompt = turns.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0);
  const cacheRead = turns.reduce((sum, s) => sum + (s.cacheReadTokens ?? 0), 0);
  const timed = turns.filter((s) => s.modelDuration != null);
  return {
    turns: turns.length,
    costUsd,
    avgCostUsd: turns.length ? costUsd / turns.length : null,
    last: turns.at(-1) ?? null,
    cacheHitRate: prompt > 0 ? cacheRead / prompt : null,
    avgModelMs: timed.length ? timed.reduce((sum, s) => sum + s.modelDuration!, 0) / timed.length : null,
  };
}

/** Cache reads / the whole prompt for one turn, or null when it isn't a turn. */
export function cacheHitRate(s: AgentStepView): number | null {
  return s.inputTokens ? (s.cacheReadTokens ?? 0) / s.inputTokens : null;
}

export interface ToolTiming {
  tool: string;
  count: number;
  avgMs: number;
  maxMs: number;
  totalMs: number;
  errors: number;
}

/** Per-tool call counts and durations, slowest on average first. */
export function toolTimings(steps: AgentStepView[]): ToolTiming[] {
  const byTool = new Map<string, ToolTiming>();
  for (const s of steps) {
    if (!s.toolName || s.duration == null) continue;
    const t = byTool.get(s.toolName) ?? { tool: s.toolName, count: 0, avgMs: 0, maxMs: 0, totalMs: 0, errors: 0 };
    t.count++;
    t.totalMs += s.duration;
    t.maxMs = Math.max(t.maxMs, s.duration);
    if (s.status === "ERROR") t.errors++;
    byTool.set(s.toolName, t);
  }
  return [...byTool.values()]
    .map((t) => ({ ...t, avgMs: t.totalMs / t.count }))
    .sort((a, b) => b.avgMs - a.avgMs);
}

/** The average time a step took (tool call, or model call for steps without one). */
export function avgStepMs(steps: AgentStepView[]): number | null {
  const times = steps.map(stepTime).filter((t): t is number => t != null);
  return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
}

export function slowestSteps(steps: AgentStepView[], n = 5): AgentStepView[] {
  return steps
    .filter((s) => stepTime(s) != null)
    .sort((a, b) => stepTime(b)! - stepTime(a)!)
    .slice(0, n);
}

/**
 * How often each kind of failure happened, most common first. Each failure counts
 * once: a failed step by its own category, and a run that failed without a step to
 * show it (a researcher's refusal or API error) by the run's. A critic or writer
 * failure is already its step, and a run ended by consecutive tool errors already
 * counted those errors.
 */
export function errorDistribution(
  steps: AgentStepView[],
  runs: RunSummaryView[] = [],
): { key: ErrorKey; count: number }[] {
  const counts = new Map<ErrorKey, number>();
  const add = (key: ErrorKey) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const s of steps) if (s.status === "ERROR") add(s.errorType ?? "OTHER");
  for (const r of runs) {
    if (r.status !== "ERROR" || r.agentRole !== "RESEARCHER" || r.endReason === "consecutive_errors") continue;
    add(r.errorType ?? "OTHER");
  }
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/** A run's wall-clock time, or the time so far when it's still running. */
export function runDuration(run: RunSummaryView, now: number | null): number | null {
  const end = run.completedAt ? Date.parse(run.completedAt) : now;
  return end == null ? null : Math.max(0, end - Date.parse(run.startedAt));
}
