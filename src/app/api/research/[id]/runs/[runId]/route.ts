import { notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { getRunDetail } from "@/lib/research/queries";

/** One run with every step (reasoning, tool input/result, timing, tokens, cost), as JSON. */
export async function GET(_req: Request, ctx: RouteContext<"/api/research/[id]/runs/[runId]">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id, runId } = await ctx.params;
  const run = await getRunDetail(id, runId, userId);
  return run ? Response.json(run) : notFound();
}
