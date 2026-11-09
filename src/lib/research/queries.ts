import type { AgentRun, AgentStep, CriticReview, Finding, Prisma, Report } from "@/generated/prisma/client";
import type { AgentRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { sumUsage } from "./usage";
import type {
  AgentStepView,
  CriticReviewView,
  FindingView,
  ProjectDetail,
  ProjectSummary,
  ReportDetail,
  ReportSection,
  UsageView,
} from "@/types/research";

// Every query is scoped to the owner: a project that belongs to someone else
// is indistinguishable from one that doesn't exist (callers respond 404).

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const projects = await prisma.researchProject.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      query: true,
      depth: true,
      status: true,
      createdAt: true,
      _count: { select: { findings: true } },
      runs: { select: { _count: { select: { steps: true } } } },
    },
  });

  return projects.map(({ _count, runs, createdAt, ...p }) => ({
    ...p,
    stepCount: runs.reduce((sum, run) => sum + run._count.steps, 0),
    findingCount: _count.findings,
    createdAt: createdAt.toISOString(),
  }));
}

/** Minimal ownership check for mutations. */
export function findOwnedProject(id: string, userId: string) {
  return prisma.researchProject.findFirst({
    where: { id, userId },
    select: { id: true, status: true },
  });
}

const detailInclude = {
  runs: {
    orderBy: { startedAt: "asc" },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  },
  findings: { orderBy: { createdAt: "asc" } },
  redirects: { orderBy: { createdAt: "asc" } },
  report: true,
} satisfies Prisma.ResearchProjectInclude;

export async function getProjectDetail(id: string, userId: string): Promise<ProjectDetail | null> {
  const project = await prisma.researchProject.findFirst({
    where: { id, userId },
    include: detailInclude,
  });
  if (!project) return null;

  const { runs } = project;
  // The clock covers the research. A report written later (maybe days later) has
  // its own run, and doesn't count.
  const researchRuns = runs.filter((r) => r.agentRole !== "WRITER");
  const anyRunning = researchRuns.some((r) => r.status === "RUNNING");
  const lastRun = researchRuns.at(-1);

  return {
    id: project.id,
    title: project.title,
    query: project.query,
    depth: project.depth,
    focusAreas: project.focusAreas,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    startedAt: runs[0]?.startedAt.toISOString() ?? null,
    endedAt: !anyRunning && lastRun?.completedAt ? lastRun.completedAt.toISOString() : null,
    // All runs in order (researcher rounds, critic, writer), so the timeline reads as one story
    steps: runs.flatMap((run) => run.steps.map((s) => toStepView(s, run))),
    findings: project.findings.map(toFindingView),
    redirects: project.redirects.map((r) => ({
      id: r.id,
      instruction: r.instruction,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    round: Math.max(1, ...runs.filter((r) => r.agentRole === "RESEARCHER").map((r) => r.round)),
    usage: sumUsage(runs.map(toUsageView)),
    runUsage: Object.fromEntries(runs.map((r) => [r.id, toUsageView(r)])),
    runRoles: Object.fromEntries(runs.map((r) => [r.id, r.agentRole])),
    report: project.report && toReportDetail(project.report),
    reportDraft: null, // read from Redis by the page, only while the writer runs
  };
}

/** The UI shape of a step; also what the `step_complete` event carries. */
export function toStepView(s: AgentStep, run: { agentRole: AgentRole; round: number }): AgentStepView {
  return {
    id: s.id,
    runId: s.runId,
    agentRole: run.agentRole,
    round: run.round,
    stepNumber: s.stepNumber,
    type: s.type,
    reasoning: s.reasoning,
    toolName: s.toolName,
    toolInput: s.toolInput,
    toolResult: s.toolResult,
    duration: s.duration,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    status: s.status,
    error: s.error,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Run totals in the UI's usage shape; the `usage` event carries one per run. */
export function toUsageView(r: AgentRun): UsageView {
  return {
    inputTokens: r.totalInputTokens,
    outputTokens: r.totalOutputTokens,
    cacheReadTokens: r.totalCacheReadTokens,
    cacheWriteTokens: r.totalCacheWriteTokens,
    costUsd: r.costUsd,
    searches: r.totalSearches,
    pagesRead: r.totalPagesRead,
  };
}

/** The UI shape of a finding; also what save_finding returns and the `finding` event carries. */
export function toFindingView(f: Finding): FindingView {
  return {
    id: f.id,
    title: f.title,
    content: f.content,
    sourceUrl: f.sourceUrl,
    sourceTitle: f.sourceTitle,
    relevance: f.relevance,
    category: f.category,
    createdAt: f.createdAt.toISOString(),
  };
}

/** The UI shape of a saved review. Coverage isn't stored on the row; the REVIEW step's result has it. */
export function toCriticReviewView(r: CriticReview, coverage = ""): CriticReviewView {
  return {
    round: r.round,
    qualityScore: r.qualityScore,
    approved: r.approved,
    coverage,
    gaps: r.gaps,
    suggestedSearches: r.suggestedSearches,
    biasConcerns: r.biasConcerns ?? "",
    reason: r.reason,
  };
}

/** The UI shape of a report; also what the `report_ready` event carries. */
export function toReportDetail(r: Report): ReportDetail {
  return {
    title: r.title,
    summary: r.summary,
    content: r.content,
    sections: Array.isArray(r.sections) ? (r.sections as unknown as ReportSection[]) : [],
    sourceCount: r.sourceCount,
    wordCount: r.wordCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
