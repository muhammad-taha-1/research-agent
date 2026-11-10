import { redis } from "@/lib/queue/connection";

// Human controls read by the agent loop at each step boundary. They live in Redis
// so the API can set them while a worker runs the loop in another process.
//
//   research:{id}:pause      "1" while a pause is requested
//   research:{id}:stop       "1" while a stop is requested
//   research:{id}:redirects  list of pending instructions, as JSON { id, instruction }

export interface ControlSignals {
  pause: boolean;
  stop: boolean;
}

/** A queued instruction; `id` is its Redirect row, marked `appliedAt` once the loop uses it. */
export interface PendingRedirect {
  id: string;
  instruction: string;
}

// Flags expire on their own, so one left behind by a crashed run can't stop a later one
const FLAG_TTL_SECONDS = 60 * 60 * 24;
// Pending redirects wait out a long pause; the Redirect rows are the lasting record
const REDIRECTS_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Redis stayed unreachable, so the agent can't see pause, stop, or redirect requests.
 * Rather than run on with nobody able to control it (or see it: events go through
 * Redis too), the agent pauses at its last checkpoint and can be resumed later.
 */
export class ControlUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Lost the connection to Redis (${cause instanceof Error ? cause.message : String(cause)})`, { cause });
    this.name = "ControlUnavailableError";
  }
}

// Rides out a Redis restart or network blip before giving up
const CONTROL_RETRY_DELAYS_MS = [1000, 2000, 4000];

/** Reads the controls for the agent, retrying a few times; throws ControlUnavailableError if Redis stays down. */
export async function readControl<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      const wait = CONTROL_RETRY_DELAYS_MS[attempt];
      if (wait === undefined) throw new ControlUnavailableError(error);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** The Redis keys of one project's controls. */
export function controlKeys(projectId: string) {
  return {
    pause: `research:${projectId}:pause`,
    stop: `research:${projectId}:stop`,
    redirects: `research:${projectId}:redirects`,
  };
}

/** Whether a pause or stop is requested; the agent checks at every step boundary. */
export async function readControlSignals(projectId: string): Promise<ControlSignals> {
  const k = controlKeys(projectId);
  const [pause, stop] = await redis.mget(k.pause, k.stop);
  return { pause: pause === "1", stop: stop === "1" };
}

/** Asks the agent to pause at its next step boundary (it checkpoints first). */
export async function requestPause(projectId: string): Promise<void> {
  await redis.set(controlKeys(projectId).pause, "1", "EX", FLAG_TTL_SECONDS);
}

/** Asks the agent to stop at its next step boundary; what it found is kept. */
export async function requestStop(projectId: string): Promise<void> {
  await redis.set(controlKeys(projectId).stop, "1", "EX", FLAG_TTL_SECONDS);
}

/** Clears leftover pause/stop flags before a job is queued. Pending redirects are kept. */
export async function clearControlFlags(projectId: string): Promise<void> {
  const k = controlKeys(projectId);
  await redis.del(k.pause, k.stop);
}

/** Queues a user instruction; the loop applies it at the next step boundary. */
export async function queueRedirect(projectId: string, redirect: PendingRedirect): Promise<void> {
  const key = controlKeys(projectId).redirects;
  await redis.multi().rpush(key, JSON.stringify(redirect)).expire(key, REDIRECTS_TTL_SECONDS).exec();
}

/** Whether instructions are waiting to be applied. */
export async function hasPendingRedirects(projectId: string): Promise<boolean> {
  return (await redis.llen(controlKeys(projectId).redirects)) > 0;
}

// Called only when the loop is about to apply them, so a pause never swallows a redirect
export async function takeRedirects(projectId: string): Promise<PendingRedirect[]> {
  const key = controlKeys(projectId).redirects;
  // Read and clear in one transaction, so no instruction is applied twice
  const results = await redis.multi().lrange(key, 0, -1).del(key).exec();
  const items = (results?.[0]?.[1] as string[] | undefined) ?? [];
  return items.flatMap((item) => {
    try {
      const r = JSON.parse(item) as PendingRedirect;
      return typeof r.instruction === "string" ? [r] : [];
    } catch {
      return [];
    }
  });
}
