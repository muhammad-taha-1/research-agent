import { parseBody, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { titleFromQuery } from "@/lib/research/config";
import { listProjects } from "@/lib/research/queries";
import { createResearchSchema } from "@/lib/research/schemas";
import type { ResearchDepth } from "@/generated/prisma/enums";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  return Response.json(await listProjects(userId));
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = await parseBody(req, createResearchSchema);
  if ("response" in parsed) return parsed.response;
  const { query, depth, focusAreas } = parsed.data;

  // Created idle; Phase 8's start route enqueues the agent run.
  const project = await prisma.researchProject.create({
    data: {
      userId,
      query,
      depth: depth as ResearchDepth,
      focusAreas,
      title: titleFromQuery(query),
    },
    select: { id: true },
  });

  return Response.json(project, { status: 201 });
}
