"use client";

import { useState } from "react";
import { ChevronRight, ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCost, formatDuration, formatPercent, formatTokens, hostname } from "@/lib/format";
import { cacheHitRate, ERROR_META } from "@/lib/research/analytics";
import { STEP_META, field, formatScore, resultCount, reviewOf, summarizeStep } from "@/lib/research/steps";
import type { AgentStepView, CriticReviewView } from "@/types/research";

export function StepCard({ step, active = false }: { step: AgentStepView; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const failed = step.status === "ERROR";
  const review = reviewOf(step);

  return (
    <li className="relative animate-in pl-9 duration-300 fade-in slide-in-from-bottom-2">
      {/* Icon sits on the timeline rail drawn by ResearchTimeline */}
      <span
        className={cn(
          "absolute top-1.5 left-0 flex size-6 items-center justify-center rounded-full ring-1",
          meta.tone,
        )}
      >
        {active && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-30" />}
        <Icon className="size-3.5" />
      </span>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
      >
        <ChevronRight
          className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm break-words", !open && "line-clamp-2", failed && "text-destructive")}>
            {summarizeStep(step)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
            <span>#{step.stepNumber}</span>
            <span className="uppercase tracking-wider">{meta.label}</span>
            {step.agentRole !== "RESEARCHER" && (
              <span className="uppercase tracking-wider">{step.agentRole.toLowerCase()}</span>
            )}
            <time dateTime={step.createdAt} suppressHydrationWarning>
              {new Date(step.createdAt).toLocaleTimeString([], { hour12: false })}
            </time>
            {step.duration != null && <span>{formatDuration(step.duration)}</span>}
            {failed && <span className="text-destructive">failed</span>}
          </span>
        </span>
      </button>

      {/* The critic's verdict stays visible: it's why the next round happens */}
      {review && <ReviewCard review={review} className="mt-1 mb-2 ml-2" />}

      {open && (
        <div className="mt-1 mb-2 ml-2 flex flex-col gap-3 border-l pl-4 text-sm">
          <StepDetails step={step} />
        </div>
      )}
    </li>
  );
}

/** The critic's verdict: approved or not, score, and the gaps it sends the researcher back for. */
export function ReviewCard({ review, className }: { review: CriticReviewView; className?: string }) {
  const n = review.gaps.length;
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-sm", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            review.approved
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : "border-amber-300/30 bg-amber-300/10 text-amber-200",
          )}
        >
          {review.approved ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
          {review.approved ? "Approved" : "Needs more work"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">Quality {formatScore(review.qualityScore)}/10</span>
      </div>
      {review.reason && <p className="text-muted-foreground">{review.reason}</p>}
      {n > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-medium">
            Critic found {n} {n === 1 ? "gap" : "gaps"}:
          </span>
          <ul className="flex flex-col gap-1">
            {review.gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-300" />
                <span className="min-w-0 break-words">{gap}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StepDetails({ step }: { step: AgentStepView }) {
  const input = step.toolInput;
  const result = step.toolResult;
  const review = reviewOf(step);

  return (
    <>
      {step.error && (
        <Detail label={`Error · ${ERROR_META[step.errorType ?? "OTHER"].label}`} className="text-destructive">
          {step.error}
        </Detail>
      )}

      {step.type === "SEARCH" && (
        <Detail label="Query">
          {String(field(input, "query") ?? "—")}
          {resultCount(result) != null && (
            <span className="text-muted-foreground"> · {resultCount(result)} results</span>
          )}
        </Detail>
      )}

      {step.type === "READ" && typeof field(input, "url") === "string" && (
        <Detail label="URL">
          <SourceLink url={field<string>(input, "url")!} />
        </Detail>
      )}

      {step.type === "NOTE" && (
        <Detail label={String(field(input, "title") ?? "Finding")}>
          <span className="whitespace-pre-wrap">{String(field(input, "content") ?? "")}</span>
        </Detail>
      )}

      {review?.coverage && <Detail label="Coverage">{review.coverage}</Detail>}
      {review?.biasConcerns && <Detail label="Bias concerns">{review.biasConcerns}</Detail>}
      {review && review.suggestedSearches.length > 0 && (
        <Detail label="Suggested searches">
          <ul className="flex flex-col gap-0.5">
            {review.suggestedSearches.map((q, i) => (
              <li key={i}>“{q}”</li>
            ))}
          </ul>
        </Detail>
      )}

      {step.reasoning && (
        <Detail label="Reasoning">
          <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {step.reasoning}
          </pre>
        </Detail>
      )}

      {step.toolName && (
        <Detail label={`Input · ${step.toolName}`}>
          <Json value={input} />
        </Detail>
      )}
      {result != null && (
        <Detail label="Result">
          <Json value={result} />
        </Detail>
      )}

      <UsageLine step={step} />
    </>
  );
}

/** The model call behind this step's turn: model, tokens with the cache split, cost, time. */
function UsageLine({ step }: { step: AgentStepView }) {
  if (step.inputTokens == null && step.outputTokens == null) return null;
  const hit = cacheHitRate(step);
  const parts = [
    step.model,
    `${formatTokens(step.inputTokens ?? 0)} in${hit != null && step.cacheReadTokens != null ? ` (${formatPercent(hit)} cached)` : ""}`,
    `${formatTokens(step.outputTokens ?? 0)} out`,
    step.costUsd != null && formatCost(step.costUsd),
    step.modelDuration != null && `model ${formatDuration(step.modelDuration)}`,
  ].filter(Boolean);
  return (
    <p className="font-mono text-[11px] text-muted-foreground" title="This turn's model call">
      {parts.join(" · ")}
    </p>
  );
}

function Detail({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</span>
      <div className={cn("min-w-0 break-words", className)}>{children}</div>
    </div>
  );
}

const JSON_PREVIEW_CHARS = 2000;

function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const clipped = text.length > JSON_PREVIEW_CHARS;
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {clipped ? `${text.slice(0, JSON_PREVIEW_CHARS)}\n… (${text.length - JSON_PREVIEW_CHARS} more chars)` : text}
    </pre>
  );
}

export function SourceLink({ url, title }: { url: string; title?: string | null }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1 text-sky-300 underline-offset-2 hover:underline"
      title={url}
    >
      <span className="truncate">{title || hostname(url)}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}
