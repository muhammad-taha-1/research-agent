import { jsonError, notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { requestStop } from "@/lib/control/signals";
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

  // The flag stops a running agent at its next step boundary; the worker then
  // sets the run and project to STOPPED.
  try {
    await requestStop(id);
  } catch {
    return jsonError(503, "Couldn't reach Redis to stop the agent. Is it running?");
  }

  // No agent is running (not started, still waiting for a worker, or paused), so
  // stop directly. A queued job sees the status and skips the project.
  const now = new Date();
  const [, stopped] = await prisma.$transaction([
    prisma.agentRun.updateMany({
      where: { projectId: id, status: "PAUSED" },
      data: { status: "STOPPED", endReason: "user_stop", completedAt: now },
    }),
    prisma.researchProject.updateMany({
      where: { id, status: { in: ["CREATED", "QUEUED", "PAUSED"] } },
      data: { status: "STOPPED" },
    }),
  ]);

  return stopped.count > 0
    ? Response.json({ status: "STOPPED" })
    : Response.json({ status: "STOPPING" }, { status: 202 });
}
