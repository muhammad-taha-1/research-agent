import type { AgentRun, AgentStep, Finding, Prisma } from "@/generated/prisma/client";
import type { AgentRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { sumUsage } from "./usage";
import type {
  AgentStepView,
  FindingView,
  ProjectDetail,
  ProjectSummary,
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
  report: { select: { id: true } },
} satisfies Prisma.ResearchProjectInclude;

export async function getProjectDetail(id: string, userId: string): Promise<ProjectDetail | null> {
  const project = await prisma.researchProject.findFirst({
    where: { id, userId },
    include: detailInclude,
  });
  if (!project) return null;

  const { runs } = project;
  const anyRunning = runs.some((r) => r.status === "RUNNING");
  const lastRun = runs.at(-1);

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
    steps: runs.flatMap((run) => run.steps.map((s) => toStepView(s, run.agentRole))),
    findings: project.findings.map(toFindingView),
    redirects: project.redirects.map((r) => ({
      id: r.id,
      instruction: r.instruction,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    usage: sumUsage(runs.map(toUsageView)),
    runUsage: Object.fromEntries(runs.map((r) => [r.id, toUsageView(r)])),
    hasReport: project.report !== null,
  };
}

/** The UI shape of a step; also what the `step_complete` event carries. */
export function toStepView(s: AgentStep, agentRole: AgentRole): AgentStepView {
  return {
    id: s.id,
    runId: s.runId,
    agentRole,
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
