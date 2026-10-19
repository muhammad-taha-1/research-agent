import { jsonError, notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { TERMINAL_STATUSES } from "@/lib/research/config";
import { findOwnedProject } from "@/lib/research/queries";

export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/stop">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await findOwnedProject(id, userId);
  if (!project) return notFound();
  if (TERMINAL_STATUSES.includes(project.status)) {
    return jsonError(409, `Research is already ${project.status.toLowerCase()}`);
  }

  // No job is running yet, so stopping is a direct state change. Phase 11 adds
  // the Redis stop flag for running jobs and keeps this path for paused ones.
  const now = new Date();
  await prisma.$transaction([
    prisma.agentRun.updateMany({
      where: { projectId: id, status: { in: ["RUNNING", "PAUSED"] } },
      data: { status: "STOPPED", endReason: "user_stop", completedAt: now },
    }),
    prisma.researchProject.update({ where: { id }, data: { status: "STOPPED" } }),
  ]);

  return Response.json({ status: "STOPPED" });
}
