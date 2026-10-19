"use client";

import Link from "next/link";
import { Activity, ArrowLeft, Bookmark, Clock, Footprints, Radar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNow } from "@/hooks/useNow";
import { formatDuration } from "@/lib/format";
import { DEPTH_OPTIONS } from "@/lib/research/config";
import { STATUS_META } from "@/lib/research/status";
import type { ProjectDetail } from "@/types/research";
import { AgentControls } from "./AgentControls";
import { CostTracker } from "./CostTracker";
import { CurrentActivity } from "./CurrentActivity";
import { FindingsPanel } from "./FindingsPanel";
import { ResearchTimeline } from "./ResearchTimeline";
import { StatusBadge } from "./StatusBadge";

// Renders whatever project state it's given. Phase 9 feeds it live updates from
// the SSE stream; until then it shows the server snapshot (refreshed after actions).
export function ResearchView({ project }: { project: ProjectDetail }) {
  const live = STATUS_META[project.status].live;

  const timeline = <ResearchTimeline steps={project.steps} live={live} />;
  const activity = <CurrentActivity status={project.status} steps={project.steps} />;
  const findings = <FindingsPanel findings={project.findings} />;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 lg:h-[calc(100svh-3.5rem)]">
      <header className="flex flex-col gap-3">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{project.title}</h1>
              <StatusBadge status={project.status} />
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{project.query}</p>
            {project.focusAreas.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Focus areas">
                {project.focusAreas.map((area) => (
                  <li key={area} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {area}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5" title="Depth">
              <Radar className="size-3.5" />
              {DEPTH_OPTIONS[project.depth].label}
            </span>
            <span className="inline-flex items-center gap-1.5" title="Steps">
              <Footprints className="size-3.5" />
              {project.steps.length} steps
            </span>
            <Elapsed startedAt={project.startedAt} endedAt={project.endedAt} live={live} />
          </div>
        </div>
      </header>

      <CostTracker usage={project.usage} />
      <AgentControls
        projectId={project.id}
        status={project.status}
        findingCount={project.findings.length}
        redirects={project.redirects}
      />

      {/* Desktop: timeline | activity | findings, each scrolling on its own */}
      <div className="hidden min-h-0 flex-1 gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
        {timeline}
        {activity}
        {findings}
      </div>

      {/* Mobile: one panel at a time */}
      <Tabs defaultValue="activity" className="lg:hidden">
        <TabsList className="w-full">
          <TabsTrigger value="timeline">
            <Activity />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Radar />
            Status
          </TabsTrigger>
          <TabsTrigger value="findings">
            <Bookmark />
            Findings
            {project.findings.length > 0 && <span className="font-mono text-xs">{project.findings.length}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="timeline" className="flex h-[70svh] flex-col">{timeline}</TabsContent>
        <TabsContent value="activity" className="flex h-[70svh] flex-col">{activity}</TabsContent>
        <TabsContent value="findings" className="flex h-[70svh] flex-col">{findings}</TabsContent>
      </Tabs>
    </div>
  );
}

function Elapsed({ startedAt, endedAt, live }: { startedAt: string | null; endedAt: string | null; live: boolean }) {
  const now = useNow(live && !endedAt);
  let text = "--:--";
  if (startedAt && (endedAt || now !== null)) {
    const end = endedAt ? Date.parse(endedAt) : now!;
    text = formatDuration(Math.max(0, end - Date.parse(startedAt)));
  }
  return (
    <span className="inline-flex items-center gap-1.5" title="Elapsed">
      <Clock className="size-3.5" />
      {text}
    </span>
  );
}
