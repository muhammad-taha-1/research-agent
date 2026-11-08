"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentEventType } from "@/lib/agents/core/types";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { TERMINAL_STATUSES } from "@/lib/research/config";
import { STATUS_META } from "@/lib/research/status";
import { sumUsage } from "@/lib/research/usage";
import type {
  AgentStepView,
  FindingView,
  ProjectDetail,
  ReportDetail,
  ReportDraft,
  StreamPosition,
  UsageView,
} from "@/types/research";

// Live updates for the research page. The server renders a database snapshot; this
// hook streams the events after it (GET /api/research/[id]/stream) and merges them in.
// Steps and findings merge by id, so one that's in both arrives once. Status and usage
// come from an event only if it's newer than the snapshot, so a fresh snapshot (after
// router.refresh) is never overwritten by an older event.

export interface PendingCall {
  stepNumber: number;
  tool: string;
  input: unknown;
}

/** What the agent is doing between saved steps: thinking, or running tool calls. */
export type LiveActivity = { kind: "idle" } | { kind: "thinking" } | { kind: "tools"; calls: PendingCall[] };

export type StreamConnection = "connecting" | "live" | "reconnecting" | "off";

interface Stamped<T> {
  value: T;
  at: string; // the event's timestamp
}

/** A stretch of the writer's text from `start` on, as report_chunk events delivered it. */
interface DraftSegment {
  runId: string;
  start: number;
  text: string;
}

interface ReportChunk {
  runId: string;
  offset: number;
  text: string;
}

interface LiveState {
  steps: AgentStepView[];
  findings: FindingView[];
  status: Stamped<ProjectStatus> | null;
  firstActiveAt: string | null; // when a run started, for the elapsed clock
  runUsage: Record<string, Stamped<UsageView>>;
  appliedRedirects: Record<string, string>; // redirect id → appliedAt
  draft: DraftSegment | null;
  report: ReportDetail | null; // from report_ready
  activity: LiveActivity;
}

const EMPTY: LiveState = {
  steps: [],
  findings: [],
  status: null,
  firstActiveAt: null,
  runUsage: {},
  appliedRedirects: {},
  draft: null,
  report: null,
  activity: { kind: "idle" },
};

const isTerminal = (s: ProjectStatus) => TERMINAL_STATUSES.includes(s);

export function useResearchStream(project: ProjectDetail, position: StreamPosition) {
  const router = useRouter();
  const [live, setLive] = useState<LiveState>(EMPTY);
  const [connection, setConnection] = useState<StreamConnection>("connecting");

  const merged = useMemo(() => merge(project, position.loadedAt, live), [project, position.loadedAt, live]);
  const streaming = !isTerminal(merged.status);

  // The snapshot's position, read once: after that, EventSource tracks its own place
  // (and a recreated one continues from the last event we saw).
  const lastIdRef = useRef(position.cursor);

  useEffect(() => {
    if (!streaming) return;

    const es = new EventSource(`/api/research/${project.id}/stream?after=${encodeURIComponent(lastIdRef.current)}`);

    const on = <T>(type: AgentEventType, fn: (data: T, at: string) => void) =>
      es.addEventListener(type, (e) => {
        const msg = e as MessageEvent<string>;
        if (msg.lastEventId) lastIdRef.current = msg.lastEventId;
        const { timestamp, ...data } = JSON.parse(msg.data) as { timestamp: string };
        fn(data as T, timestamp);
      });
    const update = (fn: (s: LiveState) => LiveState) => setLive(fn);

    on("thinking", () => update((s) => ({ ...s, activity: { kind: "thinking" } })));

    on<PendingCall>("tool_call", (call) =>
      update((s) => ({
        ...s,
        activity: { kind: "tools", calls: [...(s.activity.kind === "tools" ? s.activity.calls : []), call] },
      })),
    );

    on<AgentStepView>("step_complete", (step) =>
      update((s) => {
        let { activity } = s;
        if (activity.kind === "tools") {
          const calls = activity.calls.filter((c) => c.stepNumber !== step.stepNumber);
          activity = calls.length ? { kind: "tools", calls } : { kind: "idle" };
        }
        return { ...s, steps: [...s.steps, step], activity };
      }),
    );

    on<FindingView>("finding", (finding) => update((s) => ({ ...s, findings: [...s.findings, finding] })));

    on<UsageView & { runId: string }>("usage", ({ runId, ...usage }, at) =>
      update((s) => ({ ...s, runUsage: { ...s.runUsage, [runId]: { value: usage, at } } })),
    );

    on<{ ids: string[]; appliedAt: string }>("redirect_applied", ({ ids, appliedAt }) =>
      update((s) => ({
        ...s,
        appliedRedirects: { ...s.appliedRedirects, ...Object.fromEntries(ids.map((id) => [id, appliedAt])) },
      })),
    );

    on<ReportChunk>("report_chunk", (chunk) => update((s) => ({ ...s, draft: extendDraft(s.draft, chunk) })));

    on<ReportDetail>("report_ready", (report) => update((s) => ({ ...s, report })));

    on<{ status: ProjectStatus }>("status_change", ({ status }, at) => {
      update((s) => ({
        ...s,
        status: { value: status, at },
        firstActiveAt: s.firstActiveAt ?? (STATUS_META[status].live ? at : null),
        activity: STATUS_META[status].live ? s.activity : { kind: "idle" },
      }));
      // The run ended: reload the snapshot so everything else (end time, redirects) is exact
      if (!STATUS_META[status].live) router.refresh();
    });

    for (const type of ["agent_done", "agent_error"] as const) {
      on(type, () => update((s) => ({ ...s, activity: { kind: "idle" } })));
    }

    on("done", () => es.close());

    es.onopen = () => setConnection("live");
    // Connection-level error: EventSource reconnects on its own and sends Last-Event-ID
    es.onerror = () => setConnection(es.readyState === EventSource.CLOSED ? "off" : "reconnecting");

    return () => {
      es.close();
      setConnection("connecting"); // what the next EventSource starts as
    };
  }, [project.id, streaming, router]);

  return { project: merged, activity: live.activity, connection };
}

function merge(project: ProjectDetail, loadedAt: string, live: LiveState): ProjectDetail {
  const newer = (x: { at: string } | null | undefined): boolean => !!x && x.at > loadedAt;

  const status = newer(live.status) ? live.status!.value : project.status;
  const runUsage = { ...project.runUsage };
  for (const [runId, u] of Object.entries(live.runUsage)) {
    if (newer(u) || !runUsage[runId]) runUsage[runId] = u.value;
  }
  // The clock times the research: a report written afterwards doesn't move it
  const running = STATUS_META[status].live && status !== "WRITING";

  return {
    ...project,
    status,
    steps: mergeSteps(project.steps, live.steps),
    findings: mergeById(project.findings, live.findings).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    redirects: project.redirects.map((r) =>
      r.appliedAt || !live.appliedRedirects[r.id] ? r : { ...r, appliedAt: live.appliedRedirects[r.id] },
    ),
    runUsage,
    usage: sumUsage(Object.values(runUsage)),
    report: newerReport(project.report, live.report),
    reportDraft: mergeDraft(project.reportDraft, live.draft),
    startedAt: project.startedAt ?? live.firstActiveAt,
    endedAt: running ? null : (project.endedAt ?? (newer(live.status) ? live.status!.at : null)),
  };
}

function newerReport(a: ReportDetail | null, b: ReportDetail | null): ReportDetail | null {
  if (!a || !b) return a ?? b;
  return b.updatedAt > a.updatedAt ? b : a;
}

/** Adds a chunk at its offset. Replayed text overlaps exactly, since it's the same text. */
function extendDraft(seg: DraftSegment | null, { runId, offset, text }: ReportChunk): DraftSegment {
  if (!seg || seg.runId !== runId || offset < seg.start) return { runId, start: offset, text };
  const end = seg.start + seg.text.length;
  if (offset > end || offset + text.length <= end) return seg; // a gap (can't happen in order), or nothing new
  return { ...seg, text: seg.text.slice(0, offset - seg.start) + text };
}

/** The page's draft (read from Redis on load) continued by the chunks streamed since. */
function mergeDraft(draft: ReportDraft | null, seg: DraftSegment | null): ReportDraft | null {
  if (!seg) return draft;
  if (draft?.runId === seg.runId && seg.start <= draft.text.length) {
    const text = draft.text.slice(0, seg.start) + seg.text;
    return text.length >= draft.text.length ? { runId: seg.runId, text } : draft;
  }
  return { runId: seg.runId, text: seg.text };
}

function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  const seen = new Set(base.map((x) => x.id));
  const added = extra.filter((x) => !seen.has(x.id) && seen.add(x.id));
  return added.length ? [...base, ...added] : base;
}

/** Runs in the order they first appear, steps by number within a run (parallel tool calls finish out of order). */
function mergeSteps(base: AgentStepView[], extra: AgentStepView[]): AgentStepView[] {
  const all = mergeById(base, extra);
  if (all === base) return base;
  const runOrder = new Map<string, number>();
  for (const s of all) if (!runOrder.has(s.runId)) runOrder.set(s.runId, runOrder.size);
  return all.toSorted((a, b) => runOrder.get(a.runId)! - runOrder.get(b.runId)! || a.stepNumber - b.stepNumber);
}
