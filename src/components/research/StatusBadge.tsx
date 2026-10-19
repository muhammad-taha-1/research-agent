import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/generated/prisma/enums";
import { STATUS_META } from "@/lib/research/status";

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] font-medium tracking-wider uppercase",
        meta.badge,
        className,
      )}
    >
      <span className="relative flex size-1.5">
        {meta.live && (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", meta.dot)} />
        )}
        <span className={cn("relative inline-flex size-1.5 rounded-full", meta.dot)} />
      </span>
      {meta.label}
    </span>
  );
}
