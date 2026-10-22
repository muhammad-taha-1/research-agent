import { redis } from "@/lib/queue/connection";

// Human controls read by the agent loop at each step boundary. They live in Redis
// so the API can set them while a worker runs the loop in another process.
//
//   research:{id}:pause      "1" while a pause is requested  (set from Phase 11)
//   research:{id}:stop       "1" while a stop is requested
//   research:{id}:redirects  list of pending instructions    (Phase 11)

export interface ControlSignals {
  pause: boolean;
  stop: boolean;
}

// Flags expire on their own, so one left behind by a crashed run can't stop a later one
const FLAG_TTL_SECONDS = 60 * 60 * 24;

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

export async function requestStop(projectId: string): Promise<void> {
  await redis.set(controlKeys(projectId).stop, "1", "EX", FLAG_TTL_SECONDS);
}

/** Clears leftover pause/stop flags before a new job starts. Pending redirects are kept. */
export async function clearControlFlags(projectId: string): Promise<void> {
  const k = controlKeys(projectId);
  await redis.del(k.pause, k.stop);
}

/** Reads AND clears the pending redirect instructions. Phase 11. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until Phase 11
export async function takeRedirects(_projectId: string): Promise<string[]> {
  return [];
}
