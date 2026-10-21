/* eslint-disable @typescript-eslint/no-unused-vars -- stubs until Phase 11 */

// Human controls read by the agent loop at each step boundary. Phase 11 backs
// these with Redis (pause/stop flags and a redirect list) so the API can set them
// while a worker runs the loop; until then the loop always sees "no signals".

export interface ControlSignals {
  pause: boolean;
  stop: boolean;
}

export async function readControlSignals(_projectId: string): Promise<ControlSignals> {
  return { pause: false, stop: false };
}

/** Reads AND clears the pending redirect instructions. */
export async function takeRedirects(_projectId: string): Promise<string[]> {
  return [];
}
