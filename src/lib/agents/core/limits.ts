import type { ResearchDepth } from "@/generated/prisma/enums";

// Checked between turns, so a run can go over by one turn.
export const DEPTH_LIMITS: Record<
  ResearchDepth,
  { maxSteps: number; maxCostUsd: number; maxDurationMs: number }
> = {
  QUICK: { maxSteps: 20, maxCostUsd: 0.5, maxDurationMs: 5 * 60_000 },
  STANDARD: { maxSteps: 50, maxCostUsd: 2, maxDurationMs: 15 * 60_000 },
  DEEP: { maxSteps: 100, maxCostUsd: 5, maxDurationMs: 30 * 60_000 },
};

/** Turns in a row where every tool call failed before the run gives up. */
export const MAX_CONSECUTIVE_ERRORS = 3;
