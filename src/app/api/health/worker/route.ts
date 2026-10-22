import { connection } from "next/server";
import { getResearchQueue, HEARTBEAT_KEY, redis } from "@/lib/queue/connection";

// "Is the worker running?" Public (the proxy skips /api/health) and reveals only counts.
export async function GET() {
  await connection(); // answer at request time; never prerender this at build

  try {
    const [heartbeat, jobs] = await Promise.all([
      redis.get(HEARTBEAT_KEY),
      getResearchQueue().getJobCounts("active", "waiting", "failed"),
    ]);
    const lastHeartbeat = heartbeat ? new Date(Number(heartbeat)).toISOString() : null;
    // The key expires 30s after the last beat, so its presence means alive
    return Response.json({ worker: { alive: heartbeat !== null, lastHeartbeat }, jobs });
  } catch (error) {
    return Response.json(
      { worker: { alive: false, lastHeartbeat: null }, error: `Redis unavailable: ${(error as Error).message}` },
      { status: 503 },
    );
  }
}
