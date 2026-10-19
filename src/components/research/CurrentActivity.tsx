import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { PIPELINE, STATUS_META } from "@/lib/research/status";
import { STEP_META, field, summarizeStep } from "@/lib/research/steps";
import type { AgentStepView } from "@/types/research";
import { Panel } from "./Panel";

interface Props {
  status: ProjectStatus;
  steps: AgentStepView[];
}

export function CurrentActivity({ status, steps }: Props) {
  const meta = STATUS_META[status];
  const latest = steps.at(-1);
  const stage = currentStage(status, steps);
  const plan = latestPlan(steps);

  return (
    <Panel title="Current activity">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              {meta.live && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", meta.dot)} />}
              <span className={cn("relative size-3 rounded-full", meta.dot)} />
            </span>
            <p className="text-lg font-medium">{meta.activity}</p>
          </div>
          {latest && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="shrink-0 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                {meta.live ? "Now" : "Last"} · {STEP_META[latest.type].label}
              </span>
              <span className="min-w-0 break-words">{summarizeStep(latest)}</span>
            </div>
          )}
        </div>

        <ol className="grid grid-cols-4 gap-2" aria-label="Pipeline">
          {PIPELINE.map((s, i) => {
            const state = i < stage.index || status === "COMPLETED" ? "done" : i === stage.index ? "current" : "pending";
            return (
              <li key={s.status} className="flex flex-col gap-2">
                <span
                  className={cn(
                    "h-1 rounded-full",
                    state === "done" && "bg-emerald-400",
                    state === "current" && (stage.halted ? "bg-muted-foreground" : "animate-pulse bg-sky-400"),
                    state === "pending" && "bg-muted",
                  )}
                />
                <span
                  className={cn(
                    "flex items-center gap-1 font-mono text-[11px] tracking-wider uppercase",
                    state === "pending" ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {state === "done" ? <Check className="size-3" /> : <Circle className="size-2.5" />}
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        {plan && (
          <div className="flex flex-col gap-4">
            <h3 className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">Research plan</h3>
            {plan.inProgress && <PlanList title="In progress" items={[plan.inProgress]} marker="bg-sky-400" />}
            <PlanList title="Remaining" items={plan.remaining} marker="bg-muted-foreground" />
            <PlanList title="Completed" items={plan.completed} marker="bg-emerald-400" />
            <PlanList title="Knowledge gaps" items={plan.gaps} marker="bg-amber-300" />
          </div>
        )}
      </div>
    </Panel>
  );
}

function PlanList({ title, items, marker }: { title: string; items: string[]; marker: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{title}</span>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", marker)} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which pipeline stage we're at; for paused/stopped/errored runs, where it halted. */
function currentStage(status: ProjectStatus, steps: AgentStepView[]) {
  const i = PIPELINE.findIndex((s) => s.status === status);
  if (i >= 0) return { index: i, halted: false };
  if (status === "COMPLETED") return { index: PIPELINE.length, halted: false };

  const role = steps.at(-1)?.agentRole;
  if (!role) return { index: -1, halted: true };
  const index = role === "WRITER" ? 3 : role === "CRITIC" ? 2 : steps.some((s) => s.type !== "PLAN") ? 1 : 0;
  return { index, halted: true };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The newest update_plan call's input is the current plan. */
function latestPlan(steps: AgentStepView[]) {
  const step = steps.findLast((s) => s.type === "PLAN");
  if (!step) return null;
  const input = step.toolInput;
  const inProgress = field(input, "in_progress") ?? field(input, "inProgress");
  return {
    inProgress: typeof inProgress === "string" ? inProgress : null,
    remaining: strings(field(input, "remaining")),
    completed: strings(field(input, "completed")),
    gaps: strings(field(input, "gaps")),
  };
}
