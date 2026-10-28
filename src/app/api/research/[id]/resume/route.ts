import { jsonError, notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { clearControlFlags } from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { getResearchQueue } from "@/lib/queue/connection";
import { findOwnedProject } from "@/lib/research/queries";

export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/resume">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await findOwnedProject(id, userId);
  if (!project) return notFound();
  if (project.status !== "PAUSED") return jsonError(409, "Research isn't paused");

  // Pending redirects stay queued and apply at the resumed run's first step
  try {
    await clearControlFlags(id);
  } catch {
    return jsonError(503, "The job queue is unavailable. Is Redis running?");
  }

  // Conditional, so two clicks can't enqueue two jobs
  const claimed = await prisma.researchProject.updateMany({
    where: { id, status: "PAUSED" },
    data: { status: "QUEUED" },
  });
  if (claimed.count === 0) return jsonError(409, "Research isn't paused");

  try {
    // orchestrateResearch finds the paused run and continues its saved conversation
    const job = await getResearchQueue().add(
      "research",
      { kind: "research", projectId: id },
      { attempts: 1, removeOnComplete: false },
    );
    return Response.json({ jobId: job.id, status: "QUEUED" }, { status: 202 });
  } catch {
    await prisma.researchProject.update({ where: { id }, data: { status: "PAUSED" } });
    return jsonError(503, "The job queue is unavailable. Is Redis running?");
  }
}
