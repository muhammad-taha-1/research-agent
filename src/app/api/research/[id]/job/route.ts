import { notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { HEARTBEAT_KEY, redis } from "@/lib/queue/connection";
import { findLiveJob, shouldHaveJob } from "@/lib/queue/jobs";
import type { JobHealth } from "@/types/research";

/** Whether a running project has a job and a worker behind it; the page offers Resume when it doesn't. */
export async function GET(_req: Request, ctx: RouteContext<"/api/research/[id]/job">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await prisma.researchProject.findFirst({
    where: { id, userId },
    select: { id: true, status: true, updatedAt: true },
  });
  if (!project) return notFound();

  try {
    const [job, heartbeat] = await Promise.all([findLiveJob(id), redis.get(HEARTBEAT_KEY)]);
    const health: JobHealth = {
      redis: true,
      job: job ? await job.getState() : null,
      workerAlive: heartbeat !== null, // the key expires 30s after the worker's last beat
      stuck: !job && shouldHaveJob(project),
    };
    return Response.json(health);
  } catch {
    const health: JobHealth = { redis: false, job: null, workerAlive: false, stuck: false };
    return Response.json(health, { status: 503 });
  }
}
