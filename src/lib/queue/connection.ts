import { Queue } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";

export type ResearchJob =
  | { kind: "research"; projectId: string } // start, resume, or continue after a crash
  | { kind: "report"; projectId: string }; // (re)generate the report only

export const QUEUE_NAME = "research";
export const HEARTBEAT_KEY = "worker:heartbeat";

export function createRedisConnection(options: RedisOptions = {}): Redis {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", options);
}

// One connection and queue per process, cached on globalThis like the Prisma client
// so Next.js hot reload doesn't open a new one on every edit.
const globalForQueue = globalThis as unknown as {
  redis?: Redis;
  researchQueue?: Queue<ResearchJob>;
};

// For plain commands (enqueueing, control flags, events, heartbeat). A command fails
// after one reconnect attempt, so a route answers 503 instead of hanging while Redis
// is down. lazyConnect: nothing connects until the first command (e.g. during `next build`).
// The worker's blocking connection is separate: it needs maxRetriesPerRequest: null.
export const redis = (globalForQueue.redis ??= createRedisConnection({
  maxRetriesPerRequest: 1,
  lazyConnect: true,
}));

/** Created on first use, since constructing a Queue connects to Redis. */
export function getResearchQueue(): Queue<ResearchJob> {
  return (globalForQueue.researchQueue ??= new Queue<ResearchJob>(QUEUE_NAME, { connection: redis }));
}
