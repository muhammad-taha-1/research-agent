import { Worker } from "bullmq";
import { event } from "@/lib/agents/core/loop";
import type { AgentEvent } from "@/lib/agents/core/types";
import { orchestrateResearch } from "@/lib/agents/orchestrator";
import { prisma } from "@/lib/db/prisma";
import { publishEvent } from "@/lib/stream/events";
import { createRedisConnection, HEARTBEAT_KEY, QUEUE_NAME, redis, type ResearchJob } from "./connection";

const CONCURRENCY = 3; // max research jobs at once
const HEARTBEAT_EVERY_MS = 10_000;
const HEARTBEAT_TTL_SECONDS = 30; // the health check calls the worker dead once the key expires

/** Starts processing research jobs. Run it in its own process: `npm run worker`. */
export function startWorker() {
  const worker = new Worker<ResearchJob>(
    QUEUE_NAME,
    async (job) => {
      const { kind, projectId } = job.data;
      const emit = (e: AgentEvent) => publishEvent(projectId, e);
      console.log(`[${projectId.slice(-6)}] job ${job.id} (${kind}) picked up`);

      if (kind === "report") throw new Error("Report generation isn't implemented yet (Phase 12)");
      await orchestrateResearch(projectId, emit, job.id);
    },
    {
      // Blocking commands need their own connection, with retries left unlimited
      connection: createRedisConnection({ maxRetriesPerRequest: null }),
      concurrency: CONCURRENCY,
      // A job whose worker died is handed back to the queue and continues from its
      // checkpoint. Allow a few of those (dev restarts count) before calling it failed.
      maxStalledCount: 3,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[${job.data.projectId.slice(-6)}] job ${job.id} finished`);
  });

  // An exception escaped the agent (the loop itself turns API errors into an ERROR outcome)
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { projectId } = job.data;
    console.error(`[${projectId.slice(-6)}] job ${job.id} failed:`, err);
    try {
      const run = await prisma.agentRun.findFirst({
        where: { projectId, status: { in: ["RUNNING", "PAUSED"] } },
        orderBy: { startedAt: "desc" },
      });
      if (run) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: { status: "ERROR", endReason: "worker_error", error: err.message, completedAt: new Date() },
        });
      }
      await prisma.researchProject.update({ where: { id: projectId }, data: { status: "ERROR" } });
      await publishEvent(projectId, event("agent_error", { runId: run?.id, reason: "worker_error", error: err.message }));
      await publishEvent(projectId, event("status_change", { status: "ERROR" }));
    } catch (recordError) {
      console.error(`[${projectId.slice(-6)}] couldn't record the failure:`, recordError);
    }
  });

  worker.on("error", (err) => console.error("Worker error:", err.message));

  const beat = () => redis.set(HEARTBEAT_KEY, Date.now(), "EX", HEARTBEAT_TTL_SECONDS).catch(() => {});
  void beat();
  const heartbeat = setInterval(beat, HEARTBEAT_EVERY_MS);

  return {
    worker,
    /**
     * Stops taking jobs without waiting for running ones (a DEEP run can take 15
     * minutes). Exit the process right after: the abandoned jobs' locks expire, and
     * the next worker picks them up and continues from their last checkpoint.
     */
    async close() {
      clearInterval(heartbeat);
      await worker.close(true);
      await redis.del(HEARTBEAT_KEY).catch(() => {});
    },
  };
}
