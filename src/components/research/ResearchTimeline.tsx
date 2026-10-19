"use client";

import { useEffect, useRef } from "react";
import { Activity } from "lucide-react";
import type { AgentStepView } from "@/types/research";
import { Panel, PanelEmpty } from "./Panel";
import { StepCard } from "./StepCard";

interface Props {
  steps: AgentStepView[];
  /** The agent is working: the newest step pulses. */
  live: boolean;
}

export function ResearchTimeline({ steps, live }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Follow new steps, but only if the reader is already near the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [steps.length]);

  return (
    <Panel title="Timeline" count={steps.length} countLabel="steps">
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {steps.length === 0 ? (
          <PanelEmpty icon={<Activity className="size-5" />}>
            Each search, page read, and note appears here as the agent works.
          </PanelEmpty>
        ) : (
          <ol className="relative flex flex-col gap-1 before:absolute before:top-3 before:bottom-3 before:left-3 before:w-px before:bg-border">
            {steps.map((step, i) => (
              <StepCard key={step.id} step={step} active={live && i === steps.length - 1} />
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>
    </Panel>
  );
}
