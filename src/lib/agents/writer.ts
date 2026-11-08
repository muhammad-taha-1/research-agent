import Anthropic from "@anthropic-ai/sdk";
import type { Finding, Prisma } from "@/generated/prisma/client";
import type { StepStatus } from "@/generated/prisma/enums";
import { anthropic, MODELS } from "@/lib/ai/anthropic";
import { REPORT_WRITER_PROMPT } from "@/lib/ai/prompts";
import { readControlSignals } from "@/lib/control/signals";
import { prisma } from "@/lib/db/prisma";
import { hostname } from "@/lib/format";
import { toReportDetail, toStepView } from "@/lib/research/queries";
import { countWords, extractSummary, extractTitle, parseReportSections } from "@/lib/research/report";
import { appendReportDraft } from "@/lib/stream/report-draft";
import type { ReportSection } from "@/types/research";
import { event, promptTokens, recordRunUsage } from "./core/loop";
import type { EmitFn } from "./core/types";

// The writer turns the project's findings into a markdown report in ONE streamed
// model call: no tools, no loop. Streaming keeps a long response clear of HTTP
// timeouts, and lets the page show the report as it's written.

const WRITER_BETAS = ["server-side-fallback-2026-07-01"]; // on a safety refusal, continue on a fallback model
const FLUSH_EVERY_MS = 100; // report_chunk batches, rather than one Redis write per token
const STOP_CHECK_EVERY_MS = 1000;

export interface ReportData {
  title: string;
  summary: string;
  content: string; // the model's markdown + the appended source list
  sections: ReportSection[];
  sourceCount: number;
  wordCount: number;
  response: Anthropic.Beta.BetaMessage; // for usage: record it on the writer's AgentRun
}

/** A finished response that can't be used as a report; carries it so its usage still counts. */
export class ReportGenerationError extends Error {
  constructor(
    message: string,
    readonly response: Anthropic.Beta.BetaMessage,
  ) {
    super(message);
  }
}

export async function generateReport(
  query: string,
  findings: Finding[],
  onChunk: (text: string) => void, // for streaming
  signal?: AbortSignal, // aborts the request (user stop)
): Promise<ReportData> {
  const findingsText = findings
    .map(
      (f) =>
        `### ${f.title}\n${f.content}\nSource: ${f.sourceUrl || "N/A"}${f.sourceTitle ? ` (${f.sourceTitle})` : ""}\n` +
        `Category: ${f.category || "general"}\nRelevance: ${f.relevance ?? "N/A"}`,
    )
    .join("\n\n---\n\n");

  const stream = anthropic.beta.messages.stream(
    {
      model: MODELS.writer,
      max_tokens: 32_000, // thinking + a 3000-word report
      betas: WRITER_BETAS,
      fallbacks: "default",
      output_config: { effort: "high" }, // synthesis is the point of the report; thinking is adaptive by default
      system: REPORT_WRITER_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Research Question: ${query}\n\n## Findings\n\n<findings>\n${findingsText}\n</findings>\n\n` +
            `Please write a comprehensive report based on these findings.`,
        },
      ],
    },
    { signal },
  );

  // Visible report text only; thinking isn't included. After a mid-stream fallback
  // the fallback model continues the same text, so the chunks still add up.
  stream.on("text", onChunk);

  const response = await stream.finalMessage();
  if (response.stop_reason === "max_tokens") {
    throw new ReportGenerationError("The report was cut off (max_tokens); raise the writer's max_tokens", response);
  }
  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation;
    throw new ReportGenerationError(`Report generation was refused${why ? `: ${why}` : ""}`, response);
  }

  const written = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trimEnd();

  // Built from the findings rather than written by the model, so every link is a
  // page the researcher actually read
  const sources = sourcesSection(findings);
  if (sources) onChunk(sources);
  const content = written + sources;

  return {
    title: extractTitle(content),
    summary: extractSummary(content),
    content,
    sections: parseReportSections(content),
    sourceCount: new Set(findings.filter((f) => f.sourceUrl).map((f) => f.sourceUrl)).size,
    wordCount: countWords(content),
    response,
  };
}

/** "## Sources" with one numbered link per distinct source URL, or "" for none. */
function sourcesSection(findings: Finding[]): string {
  const sources = new Map<string, string>();
  for (const f of findings) {
    if (f.sourceUrl && !sources.has(f.sourceUrl)) sources.set(f.sourceUrl, f.sourceTitle || hostname(f.sourceUrl));
  }
  if (sources.size === 0) return "";
  const lines = [...sources].map(([url, title], i) => `${i + 1}. [${escapeLinkText(title)}](<${url}>)`);
  return `\n\n## Sources\n\n${lines.join("\n")}\n`;
}

const escapeLinkText = (text: string) => text.replace(/\s+/g, " ").replace(/([\\[\]*_`])/g, "\\$1");

export type WriterOutcome = "COMPLETED" | "STOPPED" | "ERROR";

/**
 * Runs the writer as its own WRITER AgentRun: streams the text as `report_chunk`
 * events, saves the Report (regenerating overwrites it), and records usage. The
 * caller sets the project status before and after. A user stop aborts the request;
 * the previous report, if any, is kept.
 */
export async function runWriterRun(projectId: string, emit: EmitFn, jobId?: string): Promise<WriterOutcome> {
  const project = await prisma.researchProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { findings: { orderBy: { createdAt: "asc" } } },
  });

  // A writer run left RUNNING by a worker that died: this run replaces it
  await prisma.agentRun.updateMany({
    where: { projectId, agentRole: "WRITER", status: "RUNNING" },
    data: {
      status: "ERROR",
      endReason: "interrupted",
      error: "The worker stopped before the report was finished",
      completedAt: new Date(),
    },
  });
  const run = await prisma.agentRun.create({
    data: { projectId, agentRole: "WRITER", model: MODELS.writer, jobId },
  });
  const started = Date.now();

  const finish = async (
    outcome: WriterOutcome,
    reason: string,
    step: { status: StepStatus; result?: unknown; error?: string; response?: Anthropic.Beta.BetaMessage },
  ): Promise<WriterOutcome> => {
    if (step.response) await recordRunUsage(run.id, step.response, emit);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: outcome,
        endReason: reason,
        error: step.error ?? null,
        completedAt: new Date(),
      },
    });
    const row = await prisma.agentStep.create({
      data: {
        runId: run.id,
        stepNumber: 1,
        type: "WRITE",
        toolResult: step.result as Prisma.InputJsonValue | undefined,
        duration: Date.now() - started,
        inputTokens: step.response && promptTokens(step.response.usage),
        outputTokens: step.response?.usage.output_tokens,
        status: step.status,
        error: step.error,
      },
    });
    await emit(event("step_complete", toStepView(row, "WRITER")));
    const data = { runId: run.id, role: "WRITER", outcome, reason, error: step.error };
    await emit(event(outcome === "ERROR" ? "agent_error" : "agent_done", data));
    return outcome;
  };

  if (project.findings.length === 0) {
    return finish("ERROR", "no_findings", { status: "ERROR", error: "There are no findings to write a report from" });
  }

  // ---- Stream the text out in batches, in order ----
  let offset = 0;
  let pending = "";
  let sending = Promise.resolve();
  const flush = () => {
    if (pending) {
      const chunk = { runId: run.id, offset, text: pending };
      offset += pending.length;
      pending = "";
      sending = sending.then(async () => {
        await appendReportDraft(projectId, run.id, chunk.text);
        await emit(event("report_chunk", chunk));
      });
    }
    return sending;
  };

  // ---- Stop: pause isn't offered while writing, so stop is the only control ----
  const abort = new AbortController();
  const checkStop = async () => {
    try {
      if ((await readControlSignals(projectId)).stop) abort.abort();
    } catch {
      // Redis unreachable: keep writing
    }
  };

  await checkStop();
  if (abort.signal.aborted) return finish("STOPPED", "user_stop", { status: "SKIPPED" });

  const flusher = setInterval(flush, FLUSH_EVERY_MS);
  const stopWatch = setInterval(checkStop, STOP_CHECK_EVERY_MS);
  try {
    const report = await generateReport(project.query, project.findings, (text) => void (pending += text), abort.signal);
    clearInterval(flusher);
    await flush(); // the source list and anything else still buffered

    const fields = {
      title: report.title,
      summary: report.summary,
      content: report.content,
      sections: report.sections as unknown as Prisma.InputJsonValue,
      sourceCount: report.sourceCount,
      wordCount: report.wordCount,
    };
    const saved = await prisma.report.upsert({
      where: { projectId },
      create: { projectId, ...fields },
      update: fields,
    });
    await emit(event("report_ready", toReportDetail(saved)));

    return await finish("COMPLETED", "agent_done", {
      status: "COMPLETED",
      result: { title: report.title, wordCount: report.wordCount, sourceCount: report.sourceCount },
      response: report.response,
    });
  } catch (error) {
    clearInterval(flusher);
    await sending; // let chunks already on their way land before the end events
    if (abort.signal.aborted) return finish("STOPPED", "user_stop", { status: "SKIPPED" });
    if (error instanceof ReportGenerationError) {
      const reason = error.response.stop_reason ?? "error";
      return finish("ERROR", reason, { status: "ERROR", error: error.message, response: error.response });
    }
    // The SDK already retried 429/5xx; what's left won't fix itself
    if (error instanceof Anthropic.APIError) {
      return finish("ERROR", "api_error", { status: "ERROR", error: error.message });
    }
    throw error; // unexpected: the worker's failed handler records it
  } finally {
    clearInterval(flusher);
    clearInterval(stopWatch);
  }
}
