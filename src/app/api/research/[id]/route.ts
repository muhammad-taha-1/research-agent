import { notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { getProjectDetail } from "@/lib/research/queries";

export async function GET(_req: Request, ctx: RouteContext<"/api/research/[id]">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await getProjectDetail(id, userId);
  return project ? Response.json(project) : notFound();
}
