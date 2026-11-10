import type { Job } from "bullmq";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { ACTIVE_STATUSES } from "@/lib/research/config";
import { getResearchQueue, type ResearchJob } from "./connection";

// A project can say it's running while no job is working on it: its job was lost
// (Redis flushed or restarted without persistence), or the worker failed and
// couldn't record why. Nothing would ever move it on, so the page offers Resume.
//
// A job whose worker died is NOT stuck: it stays "active" until a worker's stall
// check hands it back to the queue, and then it continues from its checkpoint.

// Every state a job is in before it finishes
const LIVE_STATES = ["active", "waiting", "delayed", "prioritized", "waiting-children"] as const;

// Status changes and enqueueing aren't atomic (a resume sets QUEUED, then adds the
// job), so a project only counts as stuck once its status is this old
const STUCK_AFTER_MS = 15_000;

/** The project's job that hasn't finished yet, if there is one. */
export async function findLiveJob(projectId: string): Promise<Job<ResearchJob> | undefined> {
  const jobs = await getResearchQueue().getJobs([...LIVE_STATES]);
  return jobs.find((job) => job.data?.projectId === projectId);
}

type ProjectState = { id: string; status: ProjectStatus; updatedAt: Date };

/** Running by its status, for long enough that its job must exist by now. */
export function shouldHaveJob(project: ProjectState): boolean {
  return ACTIVE_STATUSES.includes(project.status) && Date.now() - project.updatedAt.getTime() >= STUCK_AFTER_MS;
}

/** Running, according to its status, with no job to run it. Throws if Redis is unreachable. */
export async function isStuck(project: ProjectState): Promise<boolean> {
  return shouldHaveJob(project) && (await findLiveJob(project.id)) === undefined;
}

/**
 * How the research ended, from its last researcher run (a failed review doesn't
 * fail the research). A project is WRITING either at the end of its pipeline or
 * for a report requested afterwards; either way this is the status it goes back to.
 */
export async function researchOutcome(projectId: string): Promise<"COMPLETED" | "STOPPED" | "ERROR"> {
  const run = await prisma.agentRun.findFirst({
    where: { projectId, agentRole: "RESEARCHER" },
    orderBy: { startedAt: "desc" },
    select: { status: true },
  });
  return run?.status === "STOPPED" || run?.status === "ERROR" ? run.status : "COMPLETED";
}
