import type Anthropic from "@anthropic-ai/sdk";
import type { ResearchProject } from "@/generated/prisma/client";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { createToolRegistry } from "@/lib/tools";
import { event, runAgentLoop } from "./core/loop";
import { AgentMemory, type SerializedMemory } from "./core/memory";
import type { AgentConfig, AgentState, EmitFn, RunOutcome } from "./core/types";
import { buildInitialMessage, createResearcherConfig } from "./researcher";

// Runs a project's agents in order, inside a worker job. Phase 13 adds the critic
// and gap-filling rounds, and Phase 12 the writer; until then a project is one
// researcher round.

// QUEUED for a fresh start or a resume; an active status when the job of a crashed
// worker gets picked up again. Anything else (e.g. stopped while still queued) is skipped.
const RUNNABLE: readonly ProjectStatus[] = ["QUEUED", "PLANNING", "RESEARCHING"];

const isFinished = (o: RunOutcome): o is "COMPLETED" | "LIMIT_REACHED" =>
  o === "COMPLETED" || o === "LIMIT_REACHED";

export async function orchestrateResearch(projectId: string, emit: EmitFn, jobId?: string): Promise<void> {
  const project = await prisma.researchProject.findUnique({ where: { id: projectId } });
  if (!project || !RUNNABLE.includes(project.status)) return;

  const outcome = await runResearcherRound(project, emit, jobId);
  if (!isFinished(outcome)) return setStatus(projectId, outcome, emit); // PAUSED / STOPPED / ERROR

  await setStatus(projectId, "COMPLETED", emit);
  await emit(event("done", {}));
}

async function runResearcherRound(project: ResearchProject, emit: EmitFn, jobId?: string): Promise<RunOutcome> {
  const tools = createToolRegistry();
  const config = createResearcherConfig(project.depth, tools);
  const state = await resumeOrStartRun(project, config, jobId);

  // PLANNING until the agent saves its first plan, RESEARCHING after that
  let planning = state.memory.toJSON().plan === null;
  await setStatus(project.id, planning ? "PLANNING" : "RESEARCHING", emit, { agent: "researcher" });
  const trackPlan: EmitFn = async (e) => {
    await emit(e);
    if (planning && e.type === "plan_update") {
      planning = false;
      await setStatus(project.id, "RESEARCHING", emit, { agent: "researcher" });
    }
  };

  const outcome = await runAgentLoop(config, state, tools, trackPlan);
  if (outcome === "PAUSED") {
    // The loop already checkpointed; a later job continues this same run
    await prisma.agentRun.update({ where: { id: state.runId }, data: { status: "PAUSED" } });
  }
  return outcome;
}

/** Continues the newest unfinished researcher run from its checkpoint, or starts a new run. */
async function resumeOrStartRun(
  project: ResearchProject,
  config: AgentConfig,
  jobId?: string,
): Promise<AgentState> {
  const base = { projectId: project.id, userId: project.userId, consecutiveErrors: 0, doneRequested: false };

  const unfinished = await prisma.agentRun.findFirst({
    where: { projectId: project.id, agentRole: "RESEARCHER", status: { in: ["RUNNING", "PAUSED"] } },
    orderBy: { startedAt: "desc" },
  });

  if (!unfinished) {
    const run = await prisma.agentRun.create({
      data: { projectId: project.id, agentRole: "RESEARCHER", model: config.model, jobId },
    });
    return {
      ...base,
      runId: run.id,
      messages: [buildInitialMessage(project)],
      memory: new AgentMemory(),
      stepNumber: 0,
      toolCalls: 0,
      costUsd: 0,
      startedAt: Date.now(),
    };
  }

  const [last, toolCalls] = await Promise.all([
    prisma.agentStep.aggregate({
      where: { runId: unfinished.id },
      _max: { stepNumber: true, createdAt: true },
    }),
    prisma.agentStep.count({ where: { runId: unfinished.id, toolName: { not: null } } }),
  ]);
  await prisma.agentRun.update({ where: { id: unfinished.id }, data: { status: "RUNNING", jobId } });

  // Steps after the last checkpoint are redone: their rows stay on the timeline, and
  // numbering continues after them. Time spent paused or crashed doesn't count
  // toward the run's duration limit.
  const activeMs = (last._max.createdAt?.getTime() ?? unfinished.startedAt.getTime()) - unfinished.startedAt.getTime();
  return {
    ...base,
    runId: unfinished.id,
    messages: (unfinished.messages as unknown as Anthropic.Beta.BetaMessageParam[] | null) ?? [
      buildInitialMessage(project),
    ],
    memory: unfinished.memory
      ? AgentMemory.fromJSON(unfinished.memory as unknown as SerializedMemory)
      : new AgentMemory(),
    stepNumber: last._max.stepNumber ?? 0,
    toolCalls,
    costUsd: unfinished.costUsd,
    startedAt: Date.now() - activeMs,
  };
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
