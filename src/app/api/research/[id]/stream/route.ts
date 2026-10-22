import { notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { TERMINAL_STATUSES } from "@/lib/research/config";
import { findOwnedProject } from "@/lib/research/queries";
import { isStreamId, readEvents } from "@/lib/stream/events";
import { formatSSE, SSE_HEARTBEAT } from "@/lib/stream/sse";

// GET /api/research/[id]/stream?after=<stream id>
// Live agent events as Server-Sent Events. Reading the request makes this run per
// request (no route config needed with Cache Components).
export async function GET(req: Request, ctx: RouteContext<"/api/research/[id]/stream">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  if (!(await findOwnedProject(id, userId))) return notFound();

  // On reconnect EventSource sends Last-Event-ID; on first connect the page passes
  // the position of its database snapshot as ?after=.
  const candidates = [req.headers.get("last-event-id"), new URL(req.url).searchParams.get("after")];
  const lastId = candidates.find((c): c is string => !!c && isStreamId(c)) ?? "0";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const item of readEvents(id, lastId, req.signal)) {
          if ("heartbeat" in item) {
            controller.enqueue(encoder.encode(SSE_HEARTBEAT));
            continue;
          }
          controller.enqueue(encoder.encode(formatSSE(item.event, item.id)));
          const { type, data } = item.event;
          // Nothing more will come; the client closes its EventSource on the same events
          if (type === "done") break;
          if (type === "status_change" && TERMINAL_STATUSES.includes(data.status as ProjectStatus)) break;
        }
      } catch {
        // The client disconnected, or Redis went away; EventSource reconnects on its own
      }
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // stop nginx-style proxies from buffering the stream
    },
  });
}
