import type {
  AgentRole,
  ErrorType,
  ProjectStatus,
  ResearchDepth,
  RunStatus,
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
  round: number; // the run's round: researcher round, or which round the critic reviewed
  stepNumber: number;
  type: StepType;
  reasoning: string | null;
  toolName: string | null;
  toolInput: unknown;
  toolResult: unknown;
  duration: number | null; // ms the tool call (or critic/writer call) took
  // The model call ("turn") that led to this step; only the turn's first step has it
  model: string | null; // the model that served it
  modelDuration: number | null; // ms
  inputTokens: number | null; // the whole prompt, cached or not
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
  status: StepStatus;
  error: string | null;
  errorType: ErrorType | null;
  createdAt: string;
}

/** One agent run: a researcher round, a critic review, or a report. */
export interface RunSummaryView {
  id: string;
  agentRole: AgentRole;
  round: number;
  status: RunStatus;
  model: string; // the model requested; steps say which one served each call
  startedAt: string;
  completedAt: string | null;
  endReason: string | null;
  error: string | null;
  errorType: ErrorType | null;
  stepCount: number;
}

/** The run debugger's data: one run with every step, and its project's other runs. */
export interface RunDetail {
  project: { id: string; title: string; status: ProjectStatus };
  run: RunSummaryView;
  usage: UsageView;
  steps: AgentStepView[];
  runs: RunSummaryView[]; // every run of the project, in order, to move between them
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

/** The critic's verdict on one round: a REVIEW step's result, and the `review` event's payload. */
export interface CriticReviewView {
  round: number;
  qualityScore: number; // 0-10
  approved: boolean;
  coverage: string;
  gaps: string[];
  suggestedSearches: string[];
  biasConcerns: string;
  reason: string;
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
  round: number; // the newest research round (1 = initial, 2+ = gap filling)
  usage: UsageView; // all runs together
  runUsage: Record<string, UsageView>; // by run id: a `usage` event replaces one entry
  runRoles: Record<string, AgentRole>; // by run id, for the per-agent cost breakdown
  runs: RunSummaryView[]; // as of the snapshot (router.refresh updates it when a run ends)
  report: ReportDetail | null; // the saved report; a `report_ready` event carries a newer one
  reportDraft: ReportDraft | null; // text streamed so far while the writer runs
}

/** A "##" or "###" heading, for the table of contents. */
export interface ReportSection {
  id: string; // the rendered heading's id
  title: string;
  level: 2 | 3;
}

export interface ReportDetail {
  title: string;
  summary: string;
  content: string; // markdown, the appended source list included
  sections: ReportSection[];
  sourceCount: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string; // regenerating overwrites the report
}

/** The writer's text so far; `report_chunk` events extend it. */
export interface ReportDraft {
  runId: string;
  text: string;
}

/** Where the page's database snapshot sits in the event stream; the live view starts there. */
export interface StreamPosition {
  cursor: string; // newest stream ID before the snapshot was read ("0" for none)
  loadedAt: string; // ISO time the snapshot was read; older events are already in it
}
