"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronRight } from "lucide-react";
import type { StepType } from "@/generated/prisma/enums";
import { useNow } from "@/hooks/useNow";
import { formatCost, formatCostTokens, formatDuration, formatPercent, formatTokens } from "@/lib/format";
import {
  avgStepMs,
  ERROR_META,
  errorDistribution,
  isTurn,
  runDuration,
  slowestSteps,
  stepTime,
  toolTimings,
  turnStats,
  turnTokens,
} from "@/lib/research/analytics";
import { AGENT_META, runTitle, STEP_META, summarizeStep } from "@/lib/research/steps";
import { cn } from "@/lib/utils";
import type { AgentStepView, RunDetail } from "@/types/research";
import { tokensOf, usageCacheHitRate } from "./CostTracker";
import {
  Bar,
  endReasonLabel,
  ErrorBreakdown,
  RunStatusLabel,
  Section,
  SlowSteps,
  StatGrid,
  ToolTimingTable,
} from "./Observability";
import { StepDetails } from "./StepCard";

const REFRESH_MS = 3000;

/** The agent debugger: every step of one run, filterable, with timing, cost, and errors. */
export function RunDebugger({ detail }: { detail: RunDetail }) {
  const { project, run, usage, steps, runs } = detail;
  const running = run.status === "RUNNING";
  const router = useRouter();
  const now = useNow(running);

  // A running run re-reads the server snapshot every few seconds
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [running, router]);

  const [type, setType] = useState<StepType | "ALL">("ALL");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const counts = useMemo(() => {
    const byType = new Map<StepType, number>();
    for (const s of steps) byType.set(s.type, (byType.get(s.type) ?? 0) + 1);
    return byType;
  }, [steps]);
  const errorCount = steps.filter((s) => s.status === "ERROR").length;
  const visible = steps.filter((s) => (type === "ALL" || s.type === type) && (!errorsOnly || s.status === "ERROR"));
  const maxTime = Math.max(0, ...steps.map((s) => stepTime(s) ?? 0));

  const turns = turnStats(steps);
  const cacheHits = usageCacheHitRate(usage);
  const avgStep = avgStepMs(steps);
  const ms = runDuration(run, now);
  const errors = errorDistribution(steps, [run]);
  const meta = AGENT_META[run.agentRole];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/research/${project.id}`}
          className="inline-flex w-fit max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span className="truncate">{project.title}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
            {runTitle(run.agentRole, run.round)}
          </h1>
          <span className="rounded-full border px-2 py-0.5 text-xs">
            <RunStatusLabel status={run.status} />
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {run.model} · started{" "}
            <time dateTime={run.startedAt} suppressHydrationWarning>
              {new Date(run.startedAt).toLocaleString([], { hour12: false })}
            </time>
            {run.endReason && ` · ended: ${endReasonLabel(run.endReason)}`}
          </span>
        </div>
        {runs.length > 1 && (
          <nav aria-label="Runs of this project" className="flex flex-wrap gap-1.5">
            {runs.map((r) => (
              <Link
                key={r.id}
                href={`/research/${project.id}/runs/${r.id}`}
                aria-current={r.id === run.id ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground",
                  r.id === run.id && "border-foreground/40 bg-accent text-foreground",
                )}
              >
                <span className={cn("size-1.5 rounded-full", AGENT_META[r.agentRole].dot)} />
                {runTitle(r.agentRole, r.round)}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {run.error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="min-w-0 break-words">
            <span className="font-medium">
              Run failed{run.errorType ? ` · ${ERROR_META[run.errorType].label}` : ""}:
            </span>{" "}
            {run.error}
          </p>
        </div>
      )}

      <StatGrid
        items={[
          {
            label: "Cost",
            value: formatCost(usage.costUsd),
            detail: `${formatTokens(tokensOf(usage))} tokens`,
          },
          {
            label: "Turns",
            value: String(turns.turns),
            detail: turns.avgCostUsd != null ? `${formatCost(turns.avgCostUsd)} per turn` : undefined,
          },
          {
            label: "Cache hit rate",
            value: cacheHits != null ? formatPercent(cacheHits) : "—",
            detail: `${formatTokens(usage.cacheReadTokens)} read · ${formatTokens(usage.cacheWriteTokens)} written`,
          },
          {
            label: "Duration",
            value: ms != null ? formatDuration(ms) : "—",
            detail: [
              avgStep != null && `${formatDuration(avgStep)} avg step`,
              turns.avgModelMs != null && `${formatDuration(turns.avgModelMs)} avg model call`,
            ]
              .filter(Boolean)
              .join(" · "),
          },
          {
            label: "Steps",
            value: String(steps.length),
            detail: errorCount > 0 ? `${errorCount} failed` : "none failed",
          },
        ]}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-3" aria-label="Steps">
          <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Filter steps">
            <FilterChip active={type === "ALL"} onClick={() => setType("ALL")} label="All" count={steps.length} />
            {[...counts].map(([t, n]) => (
              <FilterChip
                key={t}
                active={type === t}
                onClick={() => setType(type === t ? "ALL" : t)}
                label={STEP_META[t].label}
                count={n}
                tone={STEP_META[t].tone}
              />
            ))}
            {errorCount > 0 && (
              <FilterChip
                active={errorsOnly}
                onClick={() => setErrorsOnly((e) => !e)}
                label="Errors only"
                count={errorCount}
                className="sm:ml-auto"
              />
            )}
          </div>

          {visible.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              {steps.length === 0 ? "No steps yet." : "No steps match these filters."}
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {visible.map((step) => (
                <DebugStepRow key={step.id} step={step} maxTime={maxTime} />
              ))}
            </ol>
          )}
          {running && (
            <p className="font-mono text-[11px] text-muted-foreground">Running — refreshing every {REFRESH_MS / 1000}s</p>
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <Section title="Errors">
            <ErrorBreakdown errors={errors} />
          </Section>
          <Section title="Slowest steps">
            <SlowSteps steps={slowestSteps(steps)} hrefFor={(s) => `#step-${s.id}`} />
          </Section>
          <Section title="Tool timing">
            <ToolTimingTable timings={toolTimings(steps)} compact />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  tone,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
        active && "border-foreground/40 bg-accent text-foreground",
        className,
      )}
    >
      {tone && <span className={cn("size-1.5 rounded-full bg-current", tone.split(" ")[0])} />}
      {label}
      <span className="font-mono tabular-nums">{count}</span>
    </button>
  );
}

// The location hash, so a link to #step-<id> opens that step. Empty on the server.
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function DebugStepRow({ step, maxTime }: { step: AgentStepView; maxTime: number }) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const [toggled, setToggled] = useState<boolean | null>(null);
  const targeted = hash === `#step-${step.id}`;
  const open = toggled ?? targeted;

  // The page streams in after the browser looks for the #step anchor, so scroll to it here
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (targeted) rowRef.current?.scrollIntoView({ block: "start" });
  }, [targeted]);

  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const failed = step.status === "ERROR";
  const time = stepTime(step);

  return (
    <li
      ref={rowRef}
      id={`step-${step.id}`}
      className={cn(
        "scroll-mt-18 rounded-lg border border-l-2 bg-card", // clears the sticky app header
        meta.edge,
        targeted && "ring-1 ring-ring",
      )}
    >
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-accent/40 sm:grid-cols-[auto_1fr_11rem]"
      >
        <span className={cn("mt-0.5 flex size-6 items-center justify-center rounded-full ring-1", meta.tone)}>
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0">
          <span className={cn("flex items-start gap-1 text-sm break-words", failed && "text-destructive")}>
            <ChevronRight
              className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            />
            <span className={cn(!open && "line-clamp-2")}>{summarizeStep(step)}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-4.5 font-mono text-[11px] text-muted-foreground">
            <span>#{step.stepNumber}</span>
            <span className="uppercase tracking-wider">{meta.label}</span>
            {step.toolName && <span>{step.toolName}</span>}
            <time dateTime={step.createdAt} suppressHydrationWarning>
              {new Date(step.createdAt).toLocaleTimeString([], { hour12: false })}
            </time>
            {failed && <span className="text-destructive">{ERROR_META[step.errorType ?? "OTHER"].label}</span>}
          </span>
        </span>
        {/* Time against the run's slowest step; the turn's model call when this step starts one */}
        <span className="col-start-2 flex flex-col gap-1 font-mono text-[11px] text-muted-foreground tabular-nums sm:col-start-3">
          {time != null && (
            <span className="flex items-center gap-2">
              <Bar value={time} max={maxTime} />
              <span className="w-12 shrink-0 text-right text-foreground">{formatDuration(time)}</span>
            </span>
          )}
          {isTurn(step) && (
            <span className="text-right" title="This turn's model call">
              {formatCostTokens(step.costUsd ?? 0, turnTokens(step))}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm">
          <StepDetails step={step} />
        </div>
      )}
    </li>
  );
}
