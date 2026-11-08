import { prisma } from "@/lib/db/prisma";
import { redis } from "@/lib/queue/connection";
import type { ReportDraft } from "@/types/research";

// The report text streamed so far, kept next to the event stream. A page opened
// mid-write reads it (after noting its stream position), so it shows the report from
// the start instead of from whichever chunk arrives first. Chunks carry their offset,
// so text that's both in the draft and in a replayed chunk lines up exactly.
//
// One key per writer run; it expires on its own instead of being deleted at the end,
// so a page loading just as the writer finishes still finds it.

const draftKey = (projectId: string, runId: string) => `research:${projectId}:report-draft:${runId}`;
const KEEP_SECONDS = 60 * 60;

/** Never throws: like publishEvent, a Redis hiccup only costs the live view. */
export async function appendReportDraft(projectId: string, runId: string, text: string): Promise<void> {
  const key = draftKey(projectId, runId);
  try {
    await redis.multi().append(key, text).expire(key, KEEP_SECONDS).exec();
  } catch (error) {
    console.error(`[${projectId.slice(-6)}] couldn't save the report draft:`, (error as Error).message);
  }
}

/** The running writer's text so far, or null when no writer is running. */
export async function readReportDraft(projectId: string): Promise<ReportDraft | null> {
  const run = await prisma.agentRun.findFirst({
    where: { projectId, agentRole: "WRITER", status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!run) return null;
  const text = await redis.get(draftKey(projectId, run.id)).catch(() => null);
  return { runId: run.id, text: text ?? "" };
}
