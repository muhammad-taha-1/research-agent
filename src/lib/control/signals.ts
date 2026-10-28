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

export function controlKeys(projectId: string) {
  return {
    pause: `research:${projectId}:pause`,
    stop: `research:${projectId}:stop`,
    redirects: `research:${projectId}:redirects`,
  };
}

export async function readControlSignals(projectId: string): Promise<ControlSignals> {
  const k = controlKeys(projectId);
  const [pause, stop] = await redis.mget(k.pause, k.stop);
  return { pause: pause === "1", stop: stop === "1" };
}

export async function requestPause(projectId: string): Promise<void> {
  await redis.set(controlKeys(projectId).pause, "1", "EX", FLAG_TTL_SECONDS);
}

export async function requestStop(projectId: string): Promise<void> {
  await redis.set(controlKeys(projectId).stop, "1", "EX", FLAG_TTL_SECONDS);
}

/** Clears leftover pause/stop flags before a job is queued. Pending redirects are kept. */
export async function clearControlFlags(projectId: string): Promise<void> {
  const k = controlKeys(projectId);
  await redis.del(k.pause, k.stop);
}

export async function queueRedirect(projectId: string, redirect: PendingRedirect): Promise<void> {
  const key = controlKeys(projectId).redirects;
  await redis.multi().rpush(key, JSON.stringify(redirect)).expire(key, REDIRECTS_TTL_SECONDS).exec();
}

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
