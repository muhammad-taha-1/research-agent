"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { formatCost, formatCostTokens, formatDuration, formatPercent, formatTokens } from "@/lib/format";
import {
  avgStepMs,
  errorDistribution,
  runDuration,
  slowestSteps,
  toolTimings,
  turnStats,
} from "@/lib/research/analytics";
import { AGENT_META, runTitle } from "@/lib/research/steps";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/types/research";
import { tokensOf, usageCacheHitRate } from "./CostTracker";
import {
  endReasonLabel,
  ErrorBreakdown,
  RunStatusLabel,
  Section,
  SlowSteps,
  StatGrid,
  ToolTimingTable,
} from "./Observability";

/** The whole project in numbers, every run with a link to its debugger, timing, and errors. */
export function ProjectAnalytics({ project, live }: { project: ProjectDetail; live: boolean }) {
  const now = useNow(live);
  const { steps, usage, findings } = project;
  const turns = turnStats(steps);
  const cacheHits = usageCacheHitRate(usage);
  const end = project.endedAt ? Date.parse(project.endedAt) : now; // now is null until hydrated
  const totalMs = project.startedAt && end != null ? end - Date.parse(project.startedAt) : null;
  const sources = new Set(findings.flatMap((f) => (f.sourceUrl ? [f.sourceUrl] : []))).size;
  const reviews = steps.filter((s) => s.type === "REVIEW").length;
  const avgStep = avgStepMs(steps);
  const runHref = (runId: string, stepId?: string) =>
    `/research/${project.id}/runs/${runId}${stepId ? `#step-${stepId}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <StatGrid
        items={[
          { label: "Steps", value: String(steps.length), detail: `${turns.turns} model ${turns.turns === 1 ? "call" : "calls"}` },
          { label: "Searches", value: String(usage.searches) },
          { label: "Pages read", value: String(usage.pagesRead) },
          { label: "Findings", value: String(findings.length) },
          { label: "Unique sources", value: String(sources), detail: "distinct URLs cited by findings" },
          {
            label: "Tokens",
            value: formatTokens(tokensOf(usage)),
            detail: cacheHits != null ? `${formatPercent(cacheHits)} cache hits` : undefined,
          },
          {
            label: "Estimated cost",
            value: formatCost(usage.costUsd),
            detail: turns.avgCostUsd != null ? `${formatCost(turns.avgCostUsd)} per turn` : undefined,
          },
          { label: "Duration", value: totalMs != null ? formatDuration(Math.max(0, totalMs)) : "—", detail: "research only, not reports" },
          { label: "Researcher rounds", value: String(project.round) },
          { label: "Critic reviews", value: String(reviews) },
        ]}
      />

      <Section title="Runs" aside={`${project.runs.length} ${project.runs.length === 1 ? "run" : "runs"}`}>
        {project.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                  <th className="pb-2 font-medium">Run</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Steps</th>
                  <th className="pb-2 text-right font-medium">Time</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                  <th className="pb-2 text-right font-medium">Cache hits</th>
                  <th className="pb-2 pl-4 font-medium">Ended</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {project.runs.map((run) => {
                  const u = project.runUsage[run.id];
                  const hits = u && usageCacheHitRate(u);
                  const ms = runDuration(run, now);
                  const meta = AGENT_META[run.agentRole];
                  // Live step count: steps stream in before the run list refreshes
                  const stepCount = Math.max(run.stepCount, steps.filter((s) => s.runId === run.id).length);
                  return (
                    <tr key={run.id} className="border-t border-border/60">
                      <td className="py-2 pr-3">
                        <Link href={runHref(run.id)} className="inline-flex items-center gap-2 hover:underline">
                          <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
                          {runTitle(run.agentRole, run.round)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        <RunStatusLabel status={run.status} />
                      </td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">{stepCount}</td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">
                        {ms != null ? formatDuration(ms) : "—"}
                      </td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">
                        {u ? formatCostTokens(u.costUsd, tokensOf(u)) : "—"}
                      </td>
                      <td className="py-2 text-right font-mono text-xs tabular-nums">
                        {hits != null ? formatPercent(hits) : "—"}
                      </td>
                      <td
                        className={cn("py-2 pl-4 text-xs", run.status === "ERROR" ? "text-destructive" : "text-muted-foreground")}
                        title={run.error ?? undefined}
                      >
                        {endReasonLabel(run.endReason)}
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={runHref(run.id)}
                          className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                          aria-label={`Debug ${runTitle(run.agentRole, run.round)}`}
                        >
                          Debug
                          <ChevronRight className="size-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Timing"
          aside={[
            avgStep != null && `${formatDuration(avgStep)} avg step`,
            turns.avgModelMs != null && `${formatDuration(turns.avgModelMs)} avg model call`,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <ToolTimingTable timings={toolTimings(steps)} />
        </Section>
        <Section title="Slowest steps">
          <SlowSteps steps={slowestSteps(steps)} hrefFor={(s) => runHref(s.runId, s.id)} />
        </Section>
      </div>

      <Section title="Errors" aside="hover a category for what it covers">
        <ErrorBreakdown errors={errorDistribution(steps, project.runs)} />
      </Section>
    </div>
  );
}
