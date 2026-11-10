"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Activity, Bug, Loader2 } from "lucide-react";
import type { AgentRole } from "@/generated/prisma/enums";
import type { LiveActivity } from "@/hooks/useResearchStream";
import { AGENT_META, describeToolCall, runTitle } from "@/lib/research/steps";
import { cn } from "@/lib/utils";
import type { AgentStepView } from "@/types/research";
import { Panel, PanelEmpty } from "./Panel";
import { StepCard } from "./StepCard";

interface RunGroup {
  runId: string;
  role: AgentRole;
  round: number;
  steps: AgentStepView[];
}

/** Consecutive steps of one run (steps arrive grouped by run already). */
function groupByRun(steps: AgentStepView[]): RunGroup[] {
  const groups: RunGroup[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last?.runId === step.runId) last.steps.push(step);
    else groups.push({ runId: step.runId, role: step.agentRole, round: step.round, steps: [step] });
  }
  return groups;
}

const RUN_DETAIL: Partial<Record<AgentRole, (round: number) => string>> = {
  RESEARCHER: (round) => (round > 1 ? `Round ${round} — filling gaps` : "Round 1"),
  CRITIC: (round) => `Review of round ${round}`,
  WRITER: () => "Writing the report",
};

function RunHeading({ role, round, href }: { role: AgentRole; round: number; href: string }) {
  const meta = AGENT_META[role];
  return (
    <h3 className="mb-1 flex items-center gap-2 px-1 font-mono text-[11px] tracking-wider uppercase">
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
      <span className={meta.text}>{meta.label}</span>
      <span className="truncate text-muted-foreground normal-case tracking-normal">{RUN_DETAIL[role]?.(round)}</span>
      <Link
        href={href}
        className="ml-auto inline-flex shrink-0 items-center gap-1 text-muted-foreground normal-case tracking-normal hover:text-foreground"
        title="Open this run in the debugger"
      >
        <Bug className="size-3" />
        Debug
      </Link>
    </h3>
  );
}

/** The step being worked on, before it's saved: a spinner, and what the agent is doing. */
function PendingStep({ activity }: { activity: Exclude<LiveActivity, { kind: "idle" }> }) {
  const lines =
    activity.kind === "tools"
      ? activity.calls.map((c) => describeToolCall(c.tool, c.input))
      : ["Deciding the next step…"];
  return (
    <li className="relative animate-in pl-9 duration-300 fade-in" role="status">
      <span className="absolute top-1.5 left-0 flex size-6 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-border">
        <Loader2 className="size-3.5 animate-spin" />
      </span>
      <div className="flex flex-col gap-0.5 px-2 py-1.5 text-sm text-muted-foreground">
        {lines.map((line, i) => (
          <span key={i} className="flex items-start gap-2">
            <span className="size-3.5 shrink-0" /> {/* lines up with the step cards' text */}
            <span className="min-w-0 break-words">{line}</span>
          </span>
        ))}
      </div>
    </li>
  );
}

interface Props {
  projectId: string;
  steps: AgentStepView[];
  /** The agent is working: the step in progress shows a spinner (or the newest one pulses). */
  live: boolean;
  activity: LiveActivity;
}

export function ResearchTimeline({ projectId, steps, live, activity }: Props) {
  const pending = live && activity.kind !== "idle" ? activity : null;
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Follow new steps until the reader scrolls up; scrolling back to the bottom resumes it.
  // Decided from the reader's scrolling, not measured after new steps render: by then
  // a tall step (or several at once) would already put the bottom out of reach.
  const following = useRef(live || steps.length === 0); // a finished run opens at the top
  const lastTop = useRef(0);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < lastTop.current - 2) following.current = nearBottom; // moved up
    else if (nearBottom) following.current = true; // our own smooth scroll only moves down
    lastTop.current = el.scrollTop;
  }

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && following.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [steps.length, pending?.kind]);

  const groups = useMemo(() => groupByRun(steps), [steps]);
  const lastId = steps.at(-1)?.id;

  return (
    <Panel title="Timeline" count={steps.length} countLabel="steps">
      <div ref={scrollerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {steps.length === 0 ? (
          live ? (
            <PanelEmpty
              icon={
                <span className="relative flex size-3">
                  <span className="absolute inset-0 animate-ping rounded-full bg-sky-400 opacity-60" />
                  <span className="relative size-3 rounded-full bg-sky-400" />
                </span>
              }
            >
              Initializing agent…
            </PanelEmpty>
          ) : (
            <PanelEmpty icon={<Activity className="size-5" />}>
              Each search, page read, and note appears here as the agent works.
            </PanelEmpty>
          )
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.runId} aria-label={runTitle(group.role, group.round)}>
                <RunHeading
                  role={group.role}
                  round={group.round}
                  href={`/research/${projectId}/runs/${group.runId}`}
                />

                {/* The rail takes the agent's color, so whose step it is shows at a glance */}
                <ol
                  className={cn(
                    "relative flex flex-col gap-1 before:absolute before:top-3 before:bottom-3 before:left-3 before:w-px",
                    groups.length > 1 ? AGENT_META[group.role].rail : "before:bg-border",
                  )}
                >
                  {group.steps.map((step) => (
                    <StepCard key={step.id} step={step} active={live && !pending && step.id === lastId} />
                  ))}
                  {pending && group === groups.at(-1) && <PendingStep activity={pending} />}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
