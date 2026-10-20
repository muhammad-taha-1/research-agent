import type { Finding, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { FindingView, ProjectDetail, ProjectSummary } from "@/types/research";

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
    steps: runs.flatMap((run) =>
      run.steps.map((s) => ({
        id: s.id,
        runId: s.runId,
        agentRole: run.agentRole,
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
      })),
    ),
    findings: project.findings.map(toFindingView),
    redirects: project.redirects.map((r) => ({
      id: r.id,
      instruction: r.instruction,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    usage: runs.reduce(
      (u, r) => ({
        inputTokens: u.inputTokens + r.totalInputTokens,
        outputTokens: u.outputTokens + r.totalOutputTokens,
        cacheReadTokens: u.cacheReadTokens + r.totalCacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens + r.totalCacheWriteTokens,
        costUsd: u.costUsd + r.costUsd,
        searches: u.searches + r.totalSearches,
        pagesRead: u.pagesRead + r.totalPagesRead,
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        searches: 0,
        pagesRead: 0,
      },
    ),
    hasReport: project.report !== null,
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
