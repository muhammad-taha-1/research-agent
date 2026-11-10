import type Anthropic from "@anthropic-ai/sdk";
import type { AgentRun, Prisma, ResearchProject } from "@/generated/prisma/client";
import type { ProjectStatus } from "@/generated/prisma/enums";
import {
  ControlUnavailableError,
  hasPendingRedirects,
  readControl,
  readControlSignals,
} from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { REDIS_UNAVAILABLE } from "@/lib/research/config";
import { toCriticReviewView } from "@/lib/research/queries";
import { createToolRegistry } from "@/lib/tools";
import type { CriticReviewView } from "@/types/research";
import { event, runAgentLoop } from "./core/loop";
import { AgentMemory, type SerializedMemory } from "./core/memory";
import type { AgentConfig, AgentState, EmitFn, RunOutcome } from "./core/types";
import { runCriticRun } from "./critic";
import { buildInitialMessage, createResearcherConfig, type RoundBrief } from "./researcher";
import { runWriterRun, type WriterOutcome } from "./writer";

// Runs a project's agents in order, inside a worker job:
//
//   Researcher (round 1) → Critic → [gaps? Researcher (round 2, a new conversation
//   aimed at the gaps) → Critic → [gaps? Researcher (round 3)]] → Writer
//
// Where the pipeline stands is read from the database at every stage, not kept in
// memory, so a job resumed after a pause, or picked up again after a worker crash,
// skips what's done and continues where the last one stopped.

const MAX_REVIEWS = 2; // prevents endless research ↔ review loops

// QUEUED for a fresh start or a resume; an active status when the job of a crashed
// worker gets picked up again. Anything else (e.g. stopped while still queued) is skipped.
const RUNNABLE: readonly ProjectStatus[] = ["QUEUED", "PLANNING", "RESEARCHING", "REVIEWING", "WRITING"];

const isFinished = (o: RunOutcome): o is "COMPLETED" | "LIMIT_REACHED" =>
  o === "COMPLETED" || o === "LIMIT_REACHED";

/** Runs (or continues) a project's pipeline. A Redis outage pauses it instead of failing it. */
export async function orchestrateResearch(projectId: string, emit: EmitFn, jobId?: string): Promise<void> {
  try {
    await runPipeline(projectId, emit, jobId);
  } catch (error) {
    if (!(error instanceof ControlUnavailableError)) throw error;
    await pauseWithoutRedis(projectId, error, emit);
  }
}

async function runPipeline(projectId: string, emit: EmitFn, jobId?: string): Promise<void> {
  const project = await prisma.researchProject.findUnique({ where: { id: projectId } });
  if (!project || !RUNNABLE.includes(project.status)) return;

  let review: CriticReviewView | null = null; // the review that sends the researcher back
  for (let round = 1; ; round++) {
    const outcome = await researchRound(project, round, review, emit, jobId);
    if (!isFinished(outcome)) return setStatus(projectId, outcome, emit); // PAUSED / STOPPED / ERROR
    if (round > MAX_REVIEWS) break; // the round after the last review goes straight to the writer

    if (await handleControlBetweenAgents(projectId, emit)) return;
    review = await reviewRound(project, round, review, emit, jobId);
    if (!(await needsAnotherRound(projectId, round, review))) break;
    if (await handleControlBetweenAgents(projectId, emit)) return;
  }

  if (await handleControlBetweenAgents(projectId, emit)) return;
  const written = await writeRound(projectId, emit, jobId);
  if (written === "STOPPED") return setStatus(projectId, "STOPPED", emit);

  // A failed report doesn't fail the research: the timeline shows why, and the
  // report can be generated again from the finished project
  await setStatus(projectId, "COMPLETED", emit);
  await emit(event("done", {}));
}

/**
 * A `report` job: writes (or rewrites) the report from the findings so far, then
 * puts the project back where it was. Its status says how the research went, and
 * writing a report afterwards doesn't change that.
 */
export async function writeReport(
  projectId: string,
  previousStatus: ProjectStatus,
  emit: EmitFn,
  jobId?: string,
): Promise<void> {
  const project = await prisma.researchProject.findUnique({ where: { id: projectId }, select: { status: true } });
  if (project?.status !== "WRITING") return; // e.g. stopped before a worker picked the job up

  await setStatus(projectId, "WRITING", emit, { agent: "writer" });
  await runWriterRun(projectId, emit, jobId);
  await setStatus(projectId, previousStatus, emit);
}

// ---- Researcher ----

/**
 * Runs research round `round`: continues its run from the checkpoint (pause or
 * crash), skips it if it already finished, or starts it as a new conversation.
 */
async function researchRound(
  project: ResearchProject,
  round: number,
  review: CriticReviewView | null,
  emit: EmitFn,
  jobId?: string,
): Promise<RunOutcome> {
  const latest = await prisma.agentRun.findFirst({
    where: { projectId: project.id, agentRole: "RESEARCHER", round },
    orderBy: { startedAt: "desc" },
  });
  if (latest?.status === "COMPLETED") return "COMPLETED"; // ended on its own or at a limit
  if (latest?.status === "STOPPED" || latest?.status === "ERROR") return latest.status;

  const tools = createToolRegistry();
  const config = createResearcherConfig(project.depth, tools, round);
  const state = latest ? await resumeRun(latest, jobId) : await startRun(project, round, review, config, jobId);

  // PLANNING until the agent saves its first plan, RESEARCHING after that. A gap
  // round starts from the earlier rounds' plan, so it's RESEARCHING right away.
  let planning = state.memory.toJSON().plan === null;
  const info = {
    agent: "researcher",
    round,
    ...(round > 1 && {
      message: review?.gaps.length
        ? `Filling ${review.gaps.length} ${review.gaps.length === 1 ? "gap" : "gaps"} (round ${round})`
        : `Following your instruction (round ${round})`,
    }),
  };
  await setStatus(project.id, planning ? "PLANNING" : "RESEARCHING", emit, info);
  const trackPlan: EmitFn = async (e) => {
    await emit(e);
    if (planning && e.type === "plan_update") {
      planning = false;
      await setStatus(project.id, "RESEARCHING", emit, info);
    }
  };

  const outcome = await runAgentLoop(config, state, tools, trackPlan);
  if (outcome === "PAUSED") {
    // The loop already checkpointed; a later job continues this same run
    await prisma.agentRun.update({ where: { id: state.runId }, data: { status: "PAUSED" } });
  }
  return outcome;
}

/**
 * A new researcher run. Round 1 starts from the question; a gap round starts a NEW
 * conversation, seeded with what earlier rounds found and the critic's gaps, and
 * carries their memory so it doesn't repeat their searches and reads.
 */
async function startRun(
  project: ResearchProject,
  round: number,
  review: CriticReviewView | null,
  config: AgentConfig,
  jobId?: string,
): Promise<AgentState> {
  let memory = new AgentMemory();
  let brief: RoundBrief = { round };
  if (round > 1) {
    const previous = await prisma.agentRun.findFirst({
      where: { projectId: project.id, agentRole: "RESEARCHER", round: round - 1 },
      orderBy: { startedAt: "desc" },
      select: { memory: true },
    });
    if (previous?.memory) memory = AgentMemory.continueFrom(previous.memory as unknown as SerializedMemory);
    brief = {
      round,
      memorySummary: memory.buildContextSummary(),
      focusAreas: review?.gaps,
      suggestedSearches: review?.suggestedSearches,
    };
  }

  const messages = [buildInitialMessage(project, brief)];
  // Saved with the run, so a crash before the first checkpoint resumes the same conversation
  const run = await prisma.agentRun.create({
    data: {
      projectId: project.id,
      agentRole: "RESEARCHER",
      round,
      model: config.model,
      jobId,
      messages: messages as unknown as Prisma.InputJsonValue,
      memory: memory.toJSON() as unknown as Prisma.InputJsonValue,
    },
  });
  return {
    ...baseState(project),
    runId: run.id,
    round,
    messages,
    memory,
    stepNumber: 0,
    toolCalls: 0,
    costUsd: 0,
    startedAt: Date.now(),
  };
}

/** Continues an unfinished (paused, or crashed) researcher run from its checkpoint. */
async function resumeRun(run: AgentRun, jobId?: string): Promise<AgentState> {
  const project = await prisma.researchProject.findUniqueOrThrow({ where: { id: run.projectId } });
  const [last, toolCalls] = await Promise.all([
    prisma.agentStep.aggregate({
      where: { runId: run.id },
      _max: { stepNumber: true, createdAt: true },
    }),
    prisma.agentStep.count({ where: { runId: run.id, toolName: { not: null } } }),
  ]);
  // Clears what an automatic pause (Redis outage) recorded
  await prisma.agentRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", jobId, endReason: null, error: null, errorType: null },
  });

  // Steps after the last checkpoint are redone: their rows stay on the timeline, and
  // numbering continues after them. Time spent paused or crashed doesn't count
  // toward the run's duration limit.
  const activeMs = (last._max.createdAt?.getTime() ?? run.startedAt.getTime()) - run.startedAt.getTime();
  return {
    ...baseState(project),
    runId: run.id,
    round: run.round,
    // Runs from before Phase 13 saved no messages until their first checkpoint
    messages: (run.messages as unknown as Anthropic.Beta.BetaMessageParam[] | null) ?? [
      buildInitialMessage(project),
    ],
    memory: run.memory ? AgentMemory.fromJSON(run.memory as unknown as SerializedMemory) : new AgentMemory(),
    stepNumber: last._max.stepNumber ?? 0,
    toolCalls,
    costUsd: run.costUsd,
    startedAt: Date.now() - activeMs,
  };
}

function baseState(project: ResearchProject) {
  return { projectId: project.id, userId: project.userId, consecutiveErrors: 0, doneRequested: false };
}

// ---- Critic ----

/** The critic's review of round `round`: the saved one if it already ran, else a new one. Null when it failed. */
async function reviewRound(
  project: ResearchProject,
  round: number,
  previous: CriticReviewView | null,
  emit: EmitFn,
  jobId?: string,
): Promise<CriticReviewView | null> {
  const existing = await prisma.agentRun.findFirst({
    where: { projectId: project.id, agentRole: "CRITIC", round },
    orderBy: { startedAt: "desc" },
    include: { steps: { select: { toolResult: true }, take: 1 } },
  });
  if (existing?.status === "RUNNING") {
    // Left RUNNING by a worker that died mid-call: review again
    await prisma.agentRun.update({
      where: { id: existing.id },
      data: { status: "ERROR", endReason: "interrupted", error: "The worker stopped during the review", completedAt: new Date() },
    });
  } else if (existing) {
    const saved = await prisma.criticReview.findFirst({ where: { runId: existing.id } });
    const coverage = (existing.steps[0]?.toolResult as { coverage?: string } | null)?.coverage;
    return saved && toCriticReviewView(saved, coverage); // no row: the review failed, so move on
  }

  await setStatus(project.id, "REVIEWING", emit, { agent: "critic", round });
  return runCriticRun(project, round, emit, { previousGaps: previous?.gaps, jobId });
}

/** Whether to research again after round `round`'s review. */
async function needsAnotherRound(projectId: string, round: number, review: CriticReviewView | null): Promise<boolean> {
  if (review && !review.approved) return true;
  // Already started (by an earlier job of this project)
  const next = await prisma.agentRun.count({ where: { projectId, agentRole: "RESEARCHER", round: round + 1 } });
  if (next > 0) return true;
  // An instruction sent while the critic worked would otherwise never be applied
  return hasPendingRedirects(projectId).catch(() => false);
}

// ---- Writer ----

async function writeRound(projectId: string, emit: EmitFn, jobId?: string): Promise<WriterOutcome> {
  const [writer, research] = await Promise.all([
    prisma.agentRun.findFirst({
      where: { projectId, agentRole: "WRITER" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.agentRun.findFirst({
      where: { projectId, agentRole: { in: ["RESEARCHER", "CRITIC"] } },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  // The report was already written after the research ended: a crash came between
  // the writer finishing and the project being marked COMPLETED
  const researchEnded = research?.completedAt ?? research?.startedAt ?? new Date(0);
  if (writer && writer.status !== "RUNNING" && writer.startedAt >= researchEnded) {
    return writer.status === "STOPPED" ? "STOPPED" : "COMPLETED";
  }

  if ((await prisma.finding.count({ where: { projectId } })) === 0) return "COMPLETED"; // nothing to write from

  await setStatus(projectId, "WRITING", emit, { agent: "writer" });
  return runWriterRun(projectId, emit, jobId);
}

// ---- Between agents ----

/**
 * Pause and stop take effect inside an agent at its step boundaries; between agents
 * the orchestrator checks them itself. Returns true when the job should end here.
 */
async function handleControlBetweenAgents(projectId: string, emit: EmitFn): Promise<boolean> {
  const signals = await readControl(() => readControlSignals(projectId));
  if (signals.stop) {
    await setStatus(projectId, "STOPPED", emit);
    return true;
  }
  if (signals.pause) {
    // Nothing to checkpoint: the next job reads where the pipeline stands from the database
    await setStatus(projectId, "PAUSED", emit);
    return true;
  }
  return false;
}

/**
 * Redis went away mid-pipeline. Its state is in Postgres (the loop checkpoints every
 * turn), so pause: the researcher run that was going is marked PAUSED with the reason,
 * and Resume continues it once Redis is back. Between agents there's no run to mark;
 * the next job picks up the pipeline from the database as usual.
 */
async function pauseWithoutRedis(projectId: string, error: ControlUnavailableError, emit: EmitFn): Promise<void> {
  await prisma.agentRun.updateMany({
    where: { projectId, agentRole: "RESEARCHER", status: "RUNNING" },
    data: { status: "PAUSED", endReason: REDIS_UNAVAILABLE, error: error.message, errorType: "NETWORK_ERROR" },
  });
  await setStatus(projectId, "PAUSED", emit); // the event is dropped while Redis is down; the page reads the database
}

async function setStatus(
  projectId: string,
  status: ProjectStatus,
  emit: EmitFn,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.researchProject.update({ where: { id: projectId }, data: { status } });
  await emit(event("status_change", { status, ...extra }));
}
