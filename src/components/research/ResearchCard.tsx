import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Bookmark, Footprints } from "lucide-react";
import { DEPTH_OPTIONS } from "@/lib/research/config";
import type { ProjectSummary } from "@/types/research";
import { StatusBadge } from "./StatusBadge";

export function ResearchCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href={`/research/${project.id}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 font-medium leading-snug">{project.title}</h3>
        <StatusBadge status={project.status} />
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{project.query}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 font-mono text-xs whitespace-nowrap text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" title="Agent steps">
          <Footprints className="size-3.5" />
          {project.stepCount} {project.stepCount === 1 ? "step" : "steps"}
        </span>
        <span className="inline-flex items-center gap-1.5" title="Findings">
          <Bookmark className="size-3.5" />
          {project.findingCount} {project.findingCount === 1 ? "finding" : "findings"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="uppercase tracking-wider">{DEPTH_OPTIONS[project.depth].label}</span>
          <span aria-hidden>·</span>
          <time dateTime={project.createdAt} title={new Date(project.createdAt).toLocaleString()}>
            {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
          </time>
        </span>
      </div>
    </Link>
  );
}
