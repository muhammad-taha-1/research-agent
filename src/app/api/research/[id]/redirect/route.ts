import { jsonError, notFound, parseBody, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { queueRedirect } from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { TERMINAL_STATUSES } from "@/lib/research/config";
import { findOwnedProject } from "@/lib/research/queries";
import { redirectSchema } from "@/lib/research/schemas";
import type { RedirectView } from "@/types/research";

export async function POST(req: Request, ctx: RouteContext<"/api/research/[id]/redirect">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await findOwnedProject(id, userId);
  if (!project) return notFound();
  if (TERMINAL_STATUSES.includes(project.status)) {
    return jsonError(409, `Research is already ${project.status.toLowerCase()}`);
  }

  const parsed = await parseBody(req, redirectSchema);
  if ("response" in parsed) return parsed.response;

  // The row is the record; the Redis list is what the agent loop drains at its next
  // step boundary (it then sets appliedAt). Sent while paused, it waits for resume.
  const redirect = await prisma.redirect.create({
    data: { projectId: id, instruction: parsed.data.instruction },
  });
  try {
    await queueRedirect(id, { id: redirect.id, instruction: redirect.instruction });
  } catch {
    await prisma.redirect.delete({ where: { id: redirect.id } });
    return jsonError(503, "Couldn't reach Redis to send the instruction. Is it running?");
  }

  const view: RedirectView = {
    id: redirect.id,
    instruction: redirect.instruction,
    appliedAt: null,
    createdAt: redirect.createdAt.toISOString(),
  };
  return Response.json(view, { status: 201 });
}
