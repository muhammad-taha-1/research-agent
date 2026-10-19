"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Projects", icon: LayoutGrid, match: (p: string) => p === "/" || /^\/research\/(?!new)/.test(p) },
  { href: "/research/new", label: "New research", icon: Plus, match: (p: string) => p === "/research/new" },
];

export function ActiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

/** Without a pathname (the static shell), no link is highlighted. */
export function NavLinks({ pathname }: { pathname?: string }) {
  return (
    <nav className="flex flex-col gap-0.5 px-2 py-3" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = pathname !== undefined && match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              active && "bg-sidebar-accent text-sidebar-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
