import type { ProjectStatus, ResearchDepth } from "@/generated/prisma/enums";

export const DEPTH_OPTIONS: Record<
  ResearchDepth,
  { label: string; searches: string; estimate: string; description: string }
> = {
  QUICK: {
    label: "Quick",
    searches: "5–10 searches",
    estimate: "~2 min",
    description: "Surface-level scan of the main sources",
  },
  STANDARD: {
    label: "Standard",
    searches: "15–25 searches",
    estimate: "~5 min",
    description: "Good coverage with cross-checked findings",
  },
  DEEP: {
    label: "Deep",
    searches: "30–50 searches",
    estimate: "~10 min",
    description: "Thorough investigation, gap-filling rounds",
  },
};

export const DEPTHS = Object.keys(DEPTH_OPTIONS) as ResearchDepth[];

/** An agent is working (or about to): pause applies, the timeline is live. */
export const ACTIVE_STATUSES: readonly ProjectStatus[] = [
  "QUEUED",
  "PLANNING",
  "RESEARCHING",
  "REVIEWING",
  "WRITING",
];

/** Nothing more will happen without a new action from the user. */
export const TERMINAL_STATUSES: readonly ProjectStatus[] = ["COMPLETED", "STOPPED", "ERROR"];

export const QUERY_MIN = 10;
export const QUERY_MAX = 2000;
export const FOCUS_AREAS_MAX = 5;
export const FOCUS_AREA_MAX_LENGTH = 200;
export const INSTRUCTION_MAX = 1000;

/** Placeholder title until the agent names the project: the query's first sentence, trimmed. */
export function titleFromQuery(query: string): string {
  const firstSentence = query.trim().split(/(?<=[.?!])\s/)[0];
  const oneLine = firstSentence.replace(/\s+/g, " ");
  return oneLine.length > 80 ? `${oneLine.slice(0, 77).trimEnd()}…` : oneLine;
}
