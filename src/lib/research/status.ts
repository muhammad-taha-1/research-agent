import type { ProjectStatus } from "@/generated/prisma/enums";

// Status is state, so it always ships with a label (never color alone).
export const STATUS_META: Record<
  ProjectStatus,
  { label: string; dot: string; badge: string; live: boolean; activity: string }
> = {
  CREATED: {
    label: "Ready",
    dot: "bg-muted-foreground",
    badge: "border-border text-muted-foreground",
    live: false,
    activity: "Ready to launch. The agent hasn't started yet.",
  },
  QUEUED: {
    label: "Queued",
    dot: "bg-sky-400",
    badge: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    live: true,
    activity: "Waiting for a worker to pick up the job…",
  },
  PLANNING: {
    label: "Planning",
    dot: "bg-cyan-300",
    badge: "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
    live: true,
    activity: "Drafting a research plan…",
  },
  RESEARCHING: {
    label: "Researching",
    dot: "bg-emerald-400",
    badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    live: true,
    activity: "Searching and reading sources…",
  },
  REVIEWING: {
    label: "Reviewing",
    dot: "bg-rose-400",
    badge: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    live: true,
    activity: "The critic is checking the findings for gaps…",
  },
  WRITING: {
    label: "Writing",
    dot: "bg-fuchsia-400",
    badge: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300",
    live: true,
    activity: "Writing the report…",
  },
  PAUSED: {
    label: "Paused",
    dot: "bg-amber-300",
    badge: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    live: false,
    activity: "Paused. Progress is saved; resume to continue.",
  },
  COMPLETED: {
    label: "Completed",
    dot: "bg-emerald-400",
    badge: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    live: false,
    activity: "Research complete.",
  },
  STOPPED: {
    label: "Stopped",
    dot: "bg-muted-foreground",
    badge: "border-border bg-muted text-muted-foreground",
    live: false,
    activity: "Stopped. Everything found so far is kept.",
  },
  ERROR: {
    label: "Error",
    dot: "bg-destructive",
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    live: false,
    activity: "The run hit an error.",
  },
};

/** Pipeline stages shown in the activity panel, in order. */
export const PIPELINE: { status: ProjectStatus; label: string }[] = [
  { status: "PLANNING", label: "Plan" },
  { status: "RESEARCHING", label: "Research" },
  { status: "REVIEWING", label: "Review" },
  { status: "WRITING", label: "Write" },
];
