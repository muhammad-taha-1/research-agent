import { jsonError, notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { requestPause } from "@/lib/control/signals";
import { ACTIVE_STATUSES } from "@/lib/research/config";
import { findOwnedProject } from "@/lib/research/queries";

export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/pause">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await findOwnedProject(id, userId);
  if (!project) return notFound();
  if (project.status === "PAUSED") return jsonError(409, "Research is already paused");
  if (!ACTIVE_STATUSES.includes(project.status)) {
    return jsonError(409, project.status === "CREATED" ? "Research hasn't started" : `Research has already ${project.status.toLowerCase()}`);
  }

  // The flag pauses the agent at its next step boundary: the loop checkpoints, and the
  // worker sets the run and project to PAUSED and ends the job. A queued job pauses
  // as soon as it starts.
  try {
    await requestPause(id);
  } catch {
    return jsonError(503, "Couldn't reach Redis to pause the agent. Is it running?");
  }
  return Response.json({ status: "PAUSING" }, { status: 202 });
}
