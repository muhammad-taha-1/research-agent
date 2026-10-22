import type { AgentEvent } from "@/lib/agents/core/types";

// The event bus between the worker (which runs the agent) and the browser.
// Phase 9 writes events to a Redis Stream for the SSE endpoint; until then the
// worker prints them to its console.

export async function publishEvent(projectId: string, event: AgentEvent): Promise<void> {
  const line = describeEvent(event);
  if (line) console.log(`[${projectId.slice(-6)}] ${line}`);
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
