import type { AgentEvent } from "@/lib/agents/core/types";
import { redis } from "@/lib/queue/connection";

// The event bus between the worker (which runs the agent) and the SSE endpoint.
// A Redis Stream, not Pub/Sub: it's an append-only log with an ID per event, so a
// browser that reconnects asks for "everything after ID X" and misses nothing.

const key = (projectId: string) => `research:${projectId}:events`;
const KEEP_SECONDS = 60 * 60 * 24 * 7; // a week; after that the database is the record

/** Stream IDs look like `1729588800000-0`; `0` means "from the beginning". */
export const isStreamId = (id: string) => /^(0|\d+-\d+)$/.test(id);

export async function publishEvent(projectId: string, event: AgentEvent): Promise<void> {
  const line = describeEvent(event);
  if (line) console.log(`[${projectId.slice(-6)}] ${line}`);

  // Everything here is already saved in the database, so a Redis hiccup only costs
  // the live view an update. It must not fail the research run.
  try {
    await redis
      .multi()
      .xadd(key(projectId), "MAXLEN", "~", "10000", "*", "data", JSON.stringify(event))
      .expire(key(projectId), KEEP_SECONDS)
      .exec();
  } catch (error) {
    console.error(`[${projectId.slice(-6)}] couldn't publish ${event.type}:`, (error as Error).message);
  }
}

/**
 * The newest event's ID, or "0" for none. A page reads it BEFORE loading its database
 * snapshot, then streams from it: whatever the snapshot already has arrives at most
 * twice (deduplicated by ID), and nothing in between is lost.
 */
export async function latestEventId(projectId: string): Promise<string> {
  const [last] = await redis.xrevrange(key(projectId), "+", "-", "COUNT", 1);
  return last?.[0] ?? "0";
}

export type StreamItem = { heartbeat: true } | { id: string; event: AgentEvent };

/**
 * Yields events after `lastId`, waiting for new ones until `signal` aborts. Uses its
 * own connection, because XREAD BLOCK ties a connection up while it waits.
 */
export async function* readEvents(projectId: string, lastId: string, signal: AbortSignal): AsyncGenerator<StreamItem> {
  const reader = redis.duplicate();
  const stop = () => reader.disconnect();
  signal.addEventListener("abort", stop);
  try {
    while (!signal.aborted) {
      const res = await reader.xread("COUNT", 500, "BLOCK", 15_000, "STREAMS", key(projectId), lastId);
      if (!res) {
        yield { heartbeat: true }; // nothing new in 15s; keeps proxies from closing the connection
        continue;
      }
      for (const [, entries] of res) {
        for (const [id, fields] of entries) {
          lastId = id;
          yield { id, event: JSON.parse(fields[1]) as AgentEvent }; // fields = ["data", json]
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", stop);
    reader.disconnect();
  }
}

/** One readable console line per event, or null for events another one repeats. */
export function describeEvent(e: AgentEvent): string | null {
  const d = e.data;
  switch (e.type) {
    case "step_complete": {
      const detail = d.reasoning ?? JSON.stringify(d.toolInput);
      const line = String(detail).replace(/\s+/g, " ").slice(0, 160);
      const tokens = d.inputTokens ? `  [${d.inputTokens} in / ${d.outputTokens} out]` : "";
      const error = d.error ? `\n    error: ${d.error}` : "";
      return `#${d.stepNumber} ${d.type}${d.status === "ERROR" ? " ✗" : ""}  ${line}${tokens}${error}`;
    }
    case "usage":
      return `   $${d.costUsd.toFixed(4)} total · cache read ${d.cacheReadTokens} / write ${d.cacheWriteTokens} / uncached ${d.inputTokens}`;
    case "thinking":
    case "tool_call":
    case "finding":
    case "plan_update":
      return null; // step_complete shows the same thing once it's done
    default:
      return `[${e.type}] ${JSON.stringify(d)}`;
  }
}
