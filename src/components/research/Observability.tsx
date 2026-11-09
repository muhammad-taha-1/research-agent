import Link from "next/link";
import type { RunStatus } from "@/generated/prisma/enums";
import { formatDuration } from "@/lib/format";
import { ERROR_META, type ErrorKey, stepTime, type ToolTiming } from "@/lib/research/analytics";
import { STEP_META, summarizeStep } from "@/lib/research/steps";
import { cn } from "@/lib/utils";
import type { AgentStepView } from "@/types/research";

// Building blocks shared by the project's Analytics tab and the run debugger.
// Bars encode one measure (a count or a duration), so they share one neutral hue;
// the numbers beside them stay in text tokens, and every row states its value, so
// the list is its own table view.

export interface StatItem {
  label: string;
  value: string;
  detail?: string;
}

export function StatGrid({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 xl:grid-cols-5", className)}>
      {items.map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5 bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className="text-lg font-semibold tracking-tight">{s.value}</dd>
          {s.detail && <dd className="text-xs text-muted-foreground">{s.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-card", className)} aria-label={title}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b px-4">
        <h2 className="font-mono text-[11px] font-medium tracking-widest text-muted-foreground uppercase">{title}</h2>
        {aside && <span className="font-mono text-xs text-muted-foreground">{aside}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A thin horizontal bar for one value out of the largest; rounded at the data end. */
export function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-r-full bg-muted", className)} aria-hidden>
      <span className="block h-full rounded-r-[4px] bg-foreground/45" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function ErrorBreakdown({ errors }: { errors: { key: ErrorKey; count: number }[] }) {
  if (errors.length === 0) return <p className="text-sm text-muted-foreground">No errors.</p>;
  const max = errors[0].count;
  return (
    <ul className="flex flex-col gap-2.5">
      {errors.map(({ key, count }) => (
        <li key={key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm" title={ERROR_META[key].hint}>
          <span className="truncate">{ERROR_META[key].label}</span>
          <Bar value={count} max={max} />
          <span className="text-right font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Per-tool timing. `compact` (a narrow column) drops the total, which the tooltip still gives. */
export function ToolTimingTable({ timings, compact = false }: { timings: ToolTiming[]; compact?: boolean }) {
  if (timings.length === 0) return <p className="text-sm text-muted-foreground">No tool calls yet.</p>;
  const max = Math.max(...timings.map((t) => t.avgMs));
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className={cn("w-full text-sm", compact ? "min-w-[20rem]" : "min-w-[26rem]")}>
        <thead>
          <tr className="text-left font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <th className="pb-2 font-medium">Tool</th>
            <th className="pb-2 pl-2 text-right font-medium">Calls</th>
            <th className="w-1/3 pb-2 pl-4 font-medium">Avg</th>
            <th className="pb-2 pl-3 text-right font-medium">Max</th>
            {!compact && <th className="pb-2 pl-3 text-right font-medium">Total</th>}
            <th className="pb-2 pl-3 text-right font-medium">Failed</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs tabular-nums">
          {timings.map((t) => (
            <tr
              key={t.tool}
              className="border-t border-border/60"
              title={`${t.tool}: ${t.count} calls, ${formatDuration(t.totalMs)} in total`}
            >
              <td className="py-2 pr-2 font-sans text-sm">{t.tool}</td>
              <td className="py-2 text-right">{t.count}</td>
              <td className="py-2 pl-4">
                <span className="flex items-center gap-2">
                  <Bar value={t.avgMs} max={max} className={compact ? "max-w-14" : "max-w-24"} />
                  <span className="shrink-0">{formatDuration(t.avgMs)}</span>
                </span>
              </td>
              <td className="py-2 pl-3 text-right">{formatDuration(t.maxMs)}</td>
              {!compact && <td className="py-2 pl-3 text-right">{formatDuration(t.totalMs)}</td>}
              <td className={cn("py-2 text-right", t.errors > 0 ? "text-destructive" : "text-muted-foreground")}>
                {t.errors}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The slowest steps; each links to the step in its run's debugger. */
export function SlowSteps({ steps, hrefFor }: { steps: AgentStepView[]; hrefFor: (s: AgentStepView) => string }) {
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">No timed steps yet.</p>;
  const max = stepTime(steps[0]) ?? 0;
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((s) => {
        const meta = STEP_META[s.type];
        const Icon = meta.icon;
        const time = stepTime(s) ?? 0;
        const href = hrefFor(s);
        const className =
          "grid grid-cols-[1.25rem_1fr_3.5rem] items-center gap-x-2 gap-y-1 rounded-md px-1 py-1 text-sm hover:bg-accent/50";
        const content = (
          <>
            <span className={cn("flex size-5 items-center justify-center rounded-full ring-1", meta.tone)}>
              <Icon className="size-3" />
            </span>
            <span className="min-w-0 truncate">{summarizeStep(s)}</span>
            <span className="text-right font-mono text-xs tabular-nums">{formatDuration(time)}</span>
            <Bar value={time} max={max} className="col-start-2" />
          </>
        );
        return (
          <li key={s.id}>
            {/* A same-page anchor stays a plain link, so the browser scrolls and fires hashchange */}
            {href.startsWith("#") ? (
              <a href={href} className={className}>
                {content}
              </a>
            ) : (
              <Link href={href} className={className}>
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Run state ships with a label, never color alone
export const RUN_STATUS_META: Record<RunStatus, { label: string; dot: string }> = {
  RUNNING: { label: "Running", dot: "bg-emerald-400" },
  PAUSED: { label: "Paused", dot: "bg-amber-300" },
  COMPLETED: { label: "Completed", dot: "bg-muted-foreground" },
  STOPPED: { label: "Stopped", dot: "bg-orange-400" },
  ERROR: { label: "Error", dot: "bg-destructive" },
};

export function RunStatusLabel({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot, status === "RUNNING" && "animate-pulse")} />
      {meta.label}
    </span>
  );
}

/** "agent_done" → "agent done" */
export const endReasonLabel = (reason: string | null) => (reason ? reason.replaceAll("_", " ") : "—");
