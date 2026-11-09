"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Bookmark, Clock, FileText, Footprints, Radar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNow } from "@/hooks/useNow";
import { useResearchStream, type StreamConnection } from "@/hooks/useResearchStream";
import { formatDuration } from "@/lib/format";
import { DEPTH_OPTIONS } from "@/lib/research/config";
import { STATUS_META } from "@/lib/research/status";
import { AGENT_META } from "@/lib/research/steps";
import { cn } from "@/lib/utils";
import type { AgentRole, ProjectStatus } from "@/generated/prisma/enums";
import type { ProjectDetail, StreamPosition } from "@/types/research";
import { AgentControls } from "./AgentControls";
import { CostTracker } from "./CostTracker";
import { CurrentActivity } from "./CurrentActivity";
import { FindingsPanel } from "./FindingsPanel";
import { ReportView } from "./ReportView";
import { ResearchTimeline } from "./ResearchTimeline";
import { StatusBadge } from "./StatusBadge";

// The server snapshot, kept current by the live event stream (and re-fetched with
// router.refresh() after actions and when a run ends).
export function ResearchView({ project: snapshot, position }: { project: ProjectDetail; position: StreamPosition }) {
  const { project, activity: liveActivity, connection } = useResearchStream(snapshot, position);
  const live = STATUS_META[project.status].live;
  const writing = project.status === "WRITING";

  // Desktop: "Live research" | "Report". Mobile: one panel at a time, the report among them.
  // Opens on the report once there is one (or while it's written), and switches to
  // it when writing starts.
  const showReport = writing || (project.report !== null && !live);
  const [desktopTab, setDesktopTab] = useState(showReport ? "report" : "research");
  const [mobileTab, setMobileTab] = useState(showReport ? "report" : "activity");
  const [wasWriting, setWasWriting] = useState(writing);
  if (writing !== wasWriting) {
    setWasWriting(writing);
    if (writing) {
      setDesktopTab("report");
      setMobileTab("report");
    }
  }

  const timeline = <ResearchTimeline steps={project.steps} live={live} />;
  const activity = (
    <CurrentActivity status={project.status} round={project.round} steps={project.steps} activity={liveActivity} />
  );
  const findings = <FindingsPanel findings={project.findings} />;
  const report = (
    <ReportView
      projectId={project.id}
      status={project.status}
      report={project.report}
      draft={project.reportDraft}
      findingCount={project.findings.length}
      steps={project.steps}
    />
  );
  const reportLabel = (
    <>
      <FileText />
      Report
      {writing && <span className="size-1.5 animate-pulse rounded-full bg-fuchsia-400" aria-label="being written" />}
    </>
  );

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
              <ActiveAgent status={project.status} round={project.round} />
              {live && <ConnectionIndicator connection={connection} />}
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

      <CostTracker usage={project.usage} runUsage={project.runUsage} runRoles={project.runRoles} />
      <AgentControls
        projectId={project.id}
        status={project.status}
        findingCount={project.findings.length}
        hasReport={project.report !== null}
        redirects={project.redirects}
      />

      {/* Desktop: timeline | activity | findings, each scrolling on its own; or the report */}
      <Tabs
        value={desktopTab}
        onValueChange={(v) => setDesktopTab(String(v))}
        className="hidden min-h-0 flex-1 lg:flex"
      >
        <TabsList>
          <TabsTrigger value="research" className="px-3">
            <Activity />
            Live research
          </TabsTrigger>
          <TabsTrigger value="report" className="px-3">
            {reportLabel}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="research"
          className="min-h-0 gap-4 data-[hidden]:hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]"
        >
          {timeline}
          {activity}
          {findings}
        </TabsContent>
        <TabsContent value="report" className="flex min-h-0 flex-col data-[hidden]:hidden">
          {report}
        </TabsContent>
      </Tabs>

      {/* Mobile: one panel at a time */}
      <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(String(v))} className="lg:hidden">
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
          <TabsTrigger value="report">{reportLabel}</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline" className="flex h-[70svh] flex-col">{timeline}</TabsContent>
        <TabsContent value="activity" className="flex h-[70svh] flex-col">{activity}</TabsContent>
        <TabsContent value="findings" className="flex h-[70svh] flex-col">{findings}</TabsContent>
        <TabsContent value="report" className="flex h-[70svh] flex-col">{report}</TabsContent>
      </Tabs>
    </div>
  );
}

// Which agent is working while the project is in each status
const AGENT_BY_STATUS: Partial<Record<ProjectStatus, AgentRole>> = {
  PLANNING: "RESEARCHER",
  RESEARCHING: "RESEARCHER",
  REVIEWING: "CRITIC",
  WRITING: "WRITER",
};

/** The agent working right now, and on which round: "Researcher · Round 2 — filling gaps". */
function ActiveAgent({ status, round }: { status: ProjectStatus; round: number }) {
  const role = AGENT_BY_STATUS[status];
  if (!role) return null;
  const meta = AGENT_META[role];
  const detail =
    role === "RESEARCHER" && round > 1 ? `Round ${round} — filling gaps` : role === "CRITIC" ? `Reviewing round ${round}` : null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs" role="status">
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      <span className={meta.text}>{meta.label}</span>
      {detail && <span className="text-muted-foreground">· {detail}</span>}
    </span>
  );
}

const CONNECTION_META: Record<StreamConnection, { label: string; dot: string }> = {
  connecting: { label: "Connecting…", dot: "bg-muted-foreground" },
  live: { label: "Live", dot: "bg-emerald-400" },
  reconnecting: { label: "Reconnecting…", dot: "bg-amber-300" },
  off: { label: "Offline", dot: "bg-muted-foreground" },
};

/** Whether updates are arriving. State in words, not just a colored dot. */
function ConnectionIndicator({ connection }: { connection: StreamConnection }) {
  const meta = CONNECTION_META[connection];
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground" role="status">
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
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
