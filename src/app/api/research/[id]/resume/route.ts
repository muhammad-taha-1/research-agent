import { jsonError, notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { clearControlFlags } from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { getResearchQueue, type ResearchJob } from "@/lib/queue/connection";
import { findLiveJob, isStuck, researchOutcome } from "@/lib/queue/jobs";
import { ACTIVE_STATUSES } from "@/lib/research/config";
import { findOwnedProject } from "@/lib/research/queries";

const REDIS_DOWN = "The job queue is unavailable. Is Redis running?";

/**
 * Continues a paused project, or one stuck in a running state with no job behind
 * it. Either way a new job picks the pipeline up from the database: the researcher's
 * checkpointed conversation, or the stage after the last finished one.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/resume">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await findOwnedProject(id, userId);
  if (!project) return notFound();

  let job: ResearchJob;
  try {
    if (project.status === "PAUSED") {
      // A job that just paused may still be finishing up; two at once would run the same agent twice
      if (await findLiveJob(id)) return jsonError(409, "The agent is still pausing. Try again in a moment");
      job = { kind: "research", projectId: id };
    } else if (await isStuck(project)) {
      // A writer that never finished gets a report job, which also restores the status afterwards
      job =
        project.status === "WRITING"
          ? { kind: "report", projectId: id, previousStatus: await researchOutcome(id) }
          : { kind: "research", projectId: id };
    } else if (ACTIVE_STATUSES.includes(project.status)) {
      return jsonError(409, "Research is already running");
    } else {
      return jsonError(409, project.status === "CREATED" ? "Research hasn't started" : "Research isn't paused");
    }
    // Pending redirects stay queued and apply at the resumed run's first step
    await clearControlFlags(id);
  } catch {
    return jsonError(503, REDIS_DOWN);
  }

  // Conditional, so two clicks can't enqueue two jobs. A report job needs WRITING
  // (it's what tells the job it's still wanted), so a stuck writer keeps its status
  // and only its updatedAt moves.
  const status = job.kind === "report" ? "WRITING" : "QUEUED";
  const claimed = await prisma.researchProject.updateMany({
    where: { id, status: project.status, updatedAt: project.updatedAt },
    data: { status, updatedAt: new Date() },
  });
  if (claimed.count === 0) return jsonError(409, "The project changed in the meantime. Reload and try again");

  try {
    const added = await getResearchQueue().add(job.kind, job, { attempts: 1, removeOnComplete: false });
    return Response.json({ jobId: added.id, status }, { status: 202 });
  } catch {
    await prisma.researchProject.update({ where: { id }, data: { status: project.status } });
    return jsonError(503, REDIS_DOWN);
  }
}
