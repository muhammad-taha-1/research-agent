import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Sparkles, Telescope } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResearchCard } from "@/components/research/ResearchCard";
import { requireUser } from "@/lib/auth";
import { EXAMPLE_TOPICS } from "@/lib/research/config";
import { listProjects } from "@/lib/research/queries";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">Operations</p>
          <h1 className="text-2xl font-semibold tracking-tight">Research projects</h1>
        </div>
        <Link href="/research/new" className={buttonVariants({ size: "lg" })}>
          <Plus />
          New research
        </Link>
      </div>
      <Suspense fallback={<ProjectGridSkeleton />}>
        <ProjectGrid />
      </Suspense>
    </div>
  );
}

async function ProjectGrid() {
  const user = await requireUser();
  const projects = await listProjects(user.id);

  if (projects.length === 0) return <EmptyState />;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <ResearchCard key={project.id} project={project} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Telescope className="size-6" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="font-medium">No research yet</h2>
        <p className="text-sm text-muted-foreground">
          Ask a question and an agent will search the web, read sources, take notes, and write
          you a cited report, while you watch every step.
        </p>
      </div>
      <Link href="/research/new" className={buttonVariants()}>
        <Plus />
        Start your first research project
      </Link>
      <div className="mt-4 flex w-full max-w-xl flex-col gap-2">
        <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">Or try one of these</p>
        <ul className="flex flex-col gap-2">
          {EXAMPLE_TOPICS.map((topic) => (
            <li key={topic}>
              <Link
                href={`/research/new?q=${encodeURIComponent(topic)}`}
                className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-foreground/20 hover:bg-accent/40"
              >
                <Sparkles className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                <span className="min-w-0 flex-1">{topic}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ProjectGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </div>
  );
}
