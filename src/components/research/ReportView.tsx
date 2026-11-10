"use client";

import { useEffect, useMemo, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ChevronDown, Copy, Download, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useGenerateReport } from "@/hooks/useGenerateReport";
import { cn } from "@/lib/utils";
import { countWords, parseReportSections } from "@/lib/research/report";
import { TERMINAL_STATUSES } from "@/lib/research/config";
import type { ProjectStatus } from "@/generated/prisma/enums";
import type { AgentStepView, ReportDetail, ReportDraft, ReportSection } from "@/types/research";
import { Markdown } from "./Markdown";
import { PanelEmpty } from "./Panel";

interface Props {
  projectId: string;
  status: ProjectStatus;
  report: ReportDetail | null;
  draft: ReportDraft | null;
  findingCount: number;
  steps: AgentStepView[];
}

export function ReportView({ projectId, status, report, draft, findingCount, steps }: Props) {
  const writing = status === "WRITING";
  const canGenerate = TERMINAL_STATUSES.includes(status) && findingCount > 0;
  const { generate, pending } = useGenerateReport(projectId);

  // While writing, the draft as it streams in; otherwise the saved report
  const text = writing ? (draft?.text ?? "") : (report?.content ?? "");
  const sections = useMemo(
    () => (writing ? parseReportSections(text) : (report?.sections ?? [])),
    [writing, text, report],
  );

  // Follow the text as it's written, unless the reader scrolled up
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (writing && el && follow.current) el.scrollTop = el.scrollHeight;
  }, [writing, text]);
  // When writing ends, the report shown (new, or the previous one after a stop) opens at the top
  const wasWriting = useRef(writing);
  useEffect(() => {
    if (wasWriting.current && !writing) scroller.current?.scrollTo({ top: 0 });
    if (writing && !wasWriting.current) follow.current = true;
    wasWriting.current = writing;
  }, [writing]);

  // Looked up inside this view: the page renders a desktop and a mobile layout, so
  // the same heading id can exist twice
  const jump = (id: string) =>
    scroller.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // How the newest writer run ended, if it didn't produce the report shown
  const lastAttempt = writing ? undefined : steps.findLast((s) => s.agentRole === "WRITER");

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card" aria-label="Report">
      <header className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <h2 className="font-medium tracking-widest uppercase">Report</h2>
          {writing ? (
            <span className="inline-flex items-center gap-1.5 text-fuchsia-300" role="status">
              <Loader2 className="size-3 animate-spin" />
              {text ? `Writing · ${countWords(text)} words` : "Planning the report"}
            </span>
          ) : (
            report && (
              <span>
                {report.wordCount.toLocaleString()} words · {report.sourceCount} sources · {findingCount} findings
              </span>
            )
          )}
        </div>
        {report && !writing && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => copyMarkdown(report.content)}>
              <Copy />
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadMarkdown(report)}>
              <Download />
              Download .md
            </Button>
            <Button variant="ghost" size="sm" disabled={!canGenerate || pending} onClick={generate}>
              {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Regenerate
            </Button>
          </div>
        )}
      </header>

      {lastAttempt && lastAttempt.status !== "COMPLETED" && (
        <p className="flex items-start gap-2 border-b bg-amber-300/5 px-4 py-2 text-xs text-amber-200" role="status">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            {lastAttempt.status === "ERROR"
              ? `The last attempt to write the report failed${lastAttempt.error ? `: ${lastAttempt.error}` : "."}`
              : "The last report was stopped before it finished."}
            {report ? " The previous report is shown." : ""}
          </span>
        </p>
      )}

      {text ? (
        <div className="flex min-h-0 flex-1">
          {sections.length > 0 && (
            <nav className="hidden w-60 shrink-0 overflow-y-auto border-r p-4 lg:block" aria-label="Contents">
              <Contents sections={sections} onJump={jump} />
            </nav>
          )}
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            <article className="mx-auto max-w-3xl px-5 py-6 md:px-8">
              {sections.length > 0 && (
                <Collapsible className="mb-6 rounded-lg border px-3 py-2 lg:hidden">
                  <CollapsibleTrigger className="group flex w-full items-center gap-1.5 font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
                    <ChevronDown className="size-3.5 transition-transform group-data-panel-open:rotate-180" />
                    Contents
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <Contents sections={sections} onJump={jump} />
                  </CollapsibleContent>
                </Collapsible>
              )}
              {/* While writing, a cursor follows the newest text (see .report-writing in globals.css) */}
              <Markdown className={cn(writing && "report-writing")}>{text}</Markdown>
              {!writing && report && (
                <footer className="mt-10 border-t pt-4 font-mono text-[11px] text-muted-foreground" suppressHydrationWarning>
                  Written {formatDistanceToNow(new Date(report.updatedAt), { addSuffix: true })} from {findingCount}{" "}
                  {findingCount === 1 ? "finding" : "findings"}
                </footer>
              )}
            </article>
          </div>
        </div>
      ) : writing ? (
        <PanelEmpty icon={<Loader2 className="size-5 animate-spin" />}>
          The writer is reading the findings and planning the report. Text appears here as it&apos;s written.
        </PanelEmpty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
          <PanelEmpty icon={<FileText className="size-5" />}>{emptyMessage(status, findingCount)}</PanelEmpty>
          {canGenerate && (
            <Button onClick={generate} disabled={pending} className="-mt-8">
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Generate report
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function emptyMessage(status: ProjectStatus, findingCount: number): string {
  if (findingCount === 0) return "The report is written from the agent's findings, and there are none yet.";
  if (TERMINAL_STATUSES.includes(status)) {
    return `Turn ${findingCount} ${findingCount === 1 ? "finding" : "findings"} into a report with a summary, themed sections, and sources.`;
  }
  return "The report can be written once the research finishes, or after you stop it.";
}

function Contents({ sections, onJump }: { sections: ReportSection[]; onJump: (id: string) => void }) {
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {sections.map((s) => (
        <li key={s.id} className={cn(s.level === 3 && "pl-3")}>
          <a
            href={`#${s.id}`}
            onClick={(e) => {
              // Scroll the report pane, without touching the URL
              e.preventDefault();
              onJump(s.id);
            }}
            className={cn(
              "block rounded px-2 py-1 leading-snug text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
              s.level === 3 && "text-xs",
            )}
          >
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

async function copyMarkdown(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    toast.success("Report copied as markdown");
  } catch {
    toast.error("Couldn't copy to the clipboard");
  }
}

function downloadMarkdown(report: ReportDetail) {
  const name =
    report.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "report";
  const url = URL.createObjectURL(new Blob([report.content], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
