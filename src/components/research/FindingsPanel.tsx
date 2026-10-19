"use client";

import { useState } from "react";
import { Bookmark, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FindingView } from "@/types/research";
import { Panel, PanelEmpty } from "./Panel";
import { SourceLink } from "./StepCard";

export function FindingsPanel({ findings }: { findings: FindingView[] }) {
  return (
    <Panel title="Findings" count={findings.length} countLabel={findings.length === 1 ? "finding" : "findings"}>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {findings.length === 0 ? (
          <PanelEmpty icon={<Bookmark className="size-5" />}>
            Facts and insights the agent saves will collect here, each linked to its source.
          </PanelEmpty>
        ) : (
          // Newest first: the panel "fills up" from the top as the agent discovers things
          <ul className="flex flex-col gap-2">
            {findings.toReversed().map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function FindingCard({ finding }: { finding: FindingView }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="animate-in rounded-lg border bg-background/40 p-3 duration-500 fade-in">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{finding.title}</span>
        <ChevronDown
          className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      <p className={cn("mt-1.5 text-sm whitespace-pre-wrap text-muted-foreground", !open && "line-clamp-3")}>
        {finding.content}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {finding.sourceUrl && <SourceLink url={finding.sourceUrl} title={finding.sourceTitle} />}
        {finding.category && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            {finding.category.replace(/_/g, " ")}
          </span>
        )}
        {finding.relevance != null && <Relevance value={finding.relevance} />}
      </div>
    </li>
  );
}

/** Meter: the track is a lighter step of the fill's own hue. */
function Relevance({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground" title={`Relevance ${pct}%`}>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-violet-400/20" aria-hidden>
        <span className="block h-full rounded-full bg-violet-400" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono">{pct}%</span>
    </span>
  );
}
