import { jsonError, notFound, unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { clearControlFlags } from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { getResearchQueue } from "@/lib/queue/connection";
import { TERMINAL_STATUSES } from "@/lib/research/config";
import { findOwnedProject, toReportDetail } from "@/lib/research/queries";

// GET: the saved report. POST: (re)generate it in the worker; the text streams to
// the page as `report_chunk` events over the project's SSE connection.

export async function GET(_req: Request, ctx: RouteContext<"/api/research/[id]/report">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  if (!(await findOwnedProject(id, userId))) return notFound();

  const report = await prisma.report.findUnique({ where: { projectId: id } });
  return report ? Response.json(toReportDetail(report)) : jsonError(404, "No report yet");
}

export async function POST(_req: Request, ctx: RouteContext<"/api/research/[id]/report">) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await ctx.params;
  const project = await findOwnedProject(id, userId);
  if (!project) return notFound();
  const previousStatus = project.status;
  if (previousStatus === "WRITING") return jsonError(409, "The report is already being written");
  if (!TERMINAL_STATUSES.includes(previousStatus)) {
    return jsonError(
      409,
      previousStatus === "CREATED"
        ? "Research hasn't started yet"
        : "Research is still in progress. Wait for it to finish, or stop it to write a report from what it found",
    );
  }
  if ((await prisma.finding.count({ where: { projectId: id } })) === 0) {
    return jsonError(409, "There are no findings to write a report from");
  }

  // A stop flag left over from the research would abort the writer at once
  try {
    await clearControlFlags(id);
  } catch {
    return jsonError(503, "The job queue is unavailable. Is Redis running?");
  }

  // Conditional, so two clicks can't enqueue two jobs
  const claimed = await prisma.researchProject.updateMany({
    where: { id, status: previousStatus },
    data: { status: "WRITING" },
  });
  if (claimed.count === 0) return jsonError(409, "The project changed in the meantime. Reload and try again");

  try {
    const job = await getResearchQueue().add(
      "report",
      { kind: "report", projectId: id, previousStatus },
      { attempts: 1, removeOnComplete: false },
    );
    return Response.json({ jobId: job.id, status: "WRITING" }, { status: 202 });
  } catch {
    await prisma.researchProject.update({ where: { id }, data: { status: previousStatus } });
    return jsonError(503, "The job queue is unavailable. Is Redis running?");
  }
}
