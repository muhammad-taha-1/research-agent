import { formatCost, formatTokens } from "@/lib/format";
import type { UsageView } from "@/types/research";

// KPI row of stat tiles. Values use proportional sans figures (not mono/tabular)
// because each stands alone rather than aligning in a column.
export function CostTracker({ usage }: { usage: UsageView }) {
  const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const cacheHitRate = promptTokens > 0 ? usage.cacheReadTokens / promptTokens : null;

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      <Stat
        label="Tokens"
        value={formatTokens(totalTokens)}
        detail={
          totalTokens > 0
            ? `${formatTokens(usage.outputTokens)} out${cacheHitRate != null ? ` · ${Math.round(cacheHitRate * 100)}% cached` : ""}`
            : undefined
        }
      />
      <Stat label="Estimated cost" value={formatCost(usage.costUsd)} />
      <Stat label="Searches" value={String(usage.searches)} />
      <Stat label="Pages read" value={String(usage.pagesRead)} />
    </dl>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight">{value}</dd>
      {detail && <dd className="text-xs text-muted-foreground">{detail}</dd>}
    </div>
  );
}
