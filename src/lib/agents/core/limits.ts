import type { ResearchDepth } from "@/generated/prisma/enums";

type RunLimits = { maxSteps: number; maxCostUsd: number; maxDurationMs: number };

// Checked between turns, so a run can go over by one turn.
export const DEPTH_LIMITS: Record<ResearchDepth, RunLimits> = {
  QUICK: { maxSteps: 20, maxCostUsd: 0.5, maxDurationMs: 5 * 60_000 },
  STANDARD: { maxSteps: 50, maxCostUsd: 2, maxDurationMs: 15 * 60_000 },
  DEEP: { maxSteps: 100, maxCostUsd: 5, maxDurationMs: 30 * 60_000 },
};

// A gap-filling round (round 2+) chases a few specific gaps, so it gets about half
// the first round's budget.
export const GAP_ROUND_LIMITS: Record<ResearchDepth, RunLimits> = {
  QUICK: { maxSteps: 12, maxCostUsd: 0.25, maxDurationMs: 3 * 60_000 },
  STANDARD: { maxSteps: 25, maxCostUsd: 1, maxDurationMs: 8 * 60_000 },
  DEEP: { maxSteps: 50, maxCostUsd: 2.5, maxDurationMs: 15 * 60_000 },
};

/** Turns in a row where every tool call failed before the run gives up. */
export const MAX_CONSECUTIVE_ERRORS = 3;
