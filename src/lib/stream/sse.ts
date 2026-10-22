import type { AgentEvent } from "@/lib/agents/core/types";

// Server-Sent Events wire format: `id`, `event`, and `data` lines, then a blank line.
// The id is the Redis Stream ID; the browser sends it back as Last-Event-ID on reconnect.

export function formatSSE(event: AgentEvent, id?: string): string {
  // The event's timestamp rides along in data, so the client can tell it from older state
  const data = { ...event.data, timestamp: event.timestamp };
  return `${id ? `id: ${id}\n` : ""}event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_HEARTBEAT = ": ping\n\n"; // a comment line; the browser ignores it
