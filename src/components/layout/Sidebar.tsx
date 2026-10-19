import { Suspense } from "react";
import Link from "next/link";
import { Radar } from "lucide-react";
import { ActiveNavLinks, NavLinks } from "./SidebarNav";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary/15 text-sidebar-primary ring-1 ring-sidebar-primary/30">
        <Radar className="size-4" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight">Research Agent</span>
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          Mission control
        </span>
      </span>
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center px-4">
        <Brand />
      </div>
      {/* The pathname is URL data on dynamic routes, so the highlight streams in */}
      <Suspense fallback={<NavLinks />}>
        <ActiveNavLinks />
      </Suspense>
    </aside>
  );
}
