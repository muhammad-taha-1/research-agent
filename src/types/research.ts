import type {
  AgentRole,
  ProjectStatus,
  ResearchDepth,
  StepStatus,
  StepType,
} from "@/generated/prisma/enums";

// Shapes the UI renders. Dates are ISO strings because the same shapes arrive
// later as JSON over SSE (Phase 9): `step_complete` carries an AgentStepView,
// `finding` a FindingView, `usage` a UsageView.

export interface AgentStepView {
  id: string;
  runId: string;
  agentRole: AgentRole;
  stepNumber: number;
  type: StepType;
  reasoning: string | null;
  toolName: string | null;
  toolInput: unknown;
  toolResult: unknown;
  duration: number | null; // ms
  inputTokens: number | null;
  outputTokens: number | null;
  status: StepStatus;
  error: string | null;
  createdAt: string;
}

export interface FindingView {
  id: string;
  title: string;
  content: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  relevance: number | null; // 0-1
  category: string | null;
  createdAt: string;
}

export interface UsageView {
  inputTokens: number; // uncached
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  searches: number;
  pagesRead: number;
}

export interface RedirectView {
  id: string;
  instruction: string;
  appliedAt: string | null;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  query: string;
  depth: ResearchDepth;
  status: ProjectStatus;
  stepCount: number;
  findingCount: number;
  createdAt: string;
}

export interface ProjectDetail {
  id: string;
  title: string;
  query: string;
  depth: ResearchDepth;
  focusAreas: string[];
  status: ProjectStatus;
  createdAt: string;
  startedAt: string | null; // first run's start
  endedAt: string | null; // last run's end, once nothing is running
  steps: AgentStepView[];
  findings: FindingView[];
  redirects: RedirectView[];
  usage: UsageView; // all runs together
  runUsage: Record<string, UsageView>; // by run id: a `usage` event replaces one entry
  hasReport: boolean;
}

/** Where the page's database snapshot sits in the event stream; the live view starts there. */
export interface StreamPosition {
  cursor: string; // newest stream ID before the snapshot was read ("0" for none)
  loadedAt: string; // ISO time the snapshot was read; older events are already in it
}
