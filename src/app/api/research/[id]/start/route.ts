import { jsonError, notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { clearControlFlags } from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { getResearchQueue } from "@/lib/queue/connection";
import { ACTIVE_STATUSES } from "@/lib/research/config";
import { findOwnedProject } from "@/lib/research/queries";

export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/start">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await findOwnedProject(id, userId);
  if (!project) return notFound();
  if (ACTIVE_STATUSES.includes(project.status)) return jsonError(409, "Research is already running");
  if (project.status === "PAUSED") return jsonError(409, "Research is paused; resume it instead");
  if (project.status !== "CREATED") return jsonError(409, `Research has already ${project.status.toLowerCase()}`);

  try {
    await clearControlFlags(id);
  } catch {
    return jsonError(503, "The job queue is unavailable. Is Redis running?");
  }

  // Conditional, so two clicks can't enqueue two jobs
  const claimed = await prisma.researchProject.updateMany({
    where: { id, status: "CREATED" },
    data: { status: "QUEUED" },
  });
  if (claimed.count === 0) return jsonError(409, "Research is already running");

  try {
    const job = await getResearchQueue().add(
      "research",
      { kind: "research", projectId: id },
      {
        attempts: 1, // don't auto-retry agent runs
        removeOnComplete: false, // keep job data for debugging
      },
    );
    return Response.json({ jobId: job.id, status: "QUEUED" }, { status: 202 });
  } catch {
    await prisma.researchProject.update({ where: { id }, data: { status: "CREATED" } });
    return jsonError(503, "The job queue is unavailable. Is Redis running?");
  }
}
