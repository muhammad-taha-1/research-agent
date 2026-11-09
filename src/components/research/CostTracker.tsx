import type { AgentRole } from "@/generated/prisma/enums";
import { formatCost, formatCostTokens, formatPercent, formatTokens } from "@/lib/format";
import { turnStats, turnTokens } from "@/lib/research/analytics";
import { AGENT_META } from "@/lib/research/steps";
import { sumUsage } from "@/lib/research/usage";
import { cn } from "@/lib/utils";
import type { AgentStepView, UsageView } from "@/types/research";

const AGENT_ORDER: AgentRole[] = ["RESEARCHER", "CRITIC", "WRITER"];

export const tokensOf = (u: UsageView) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;

/** Cache reads / (uncached input + cache writes + cache reads). Near zero after the first turns means the prefix keeps changing. */
export function usageCacheHitRate(u: UsageView): number | null {
  const prompt = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return prompt > 0 ? u.cacheReadTokens / prompt : null;
}

interface Props {
  usage: UsageView; // all runs together
  runUsage: Record<string, UsageView>;
  runRoles: Record<string, AgentRole>;
  steps: AgentStepView[];
}

// KPI row of stat tiles. Values use proportional sans figures (not mono/tabular)
// because each stands alone rather than aligning in a column.
export function CostTracker({ usage, runUsage, runRoles, steps }: Props) {
  const totalTokens = tokensOf(usage);
  const cacheHitRate = usageCacheHitRate(usage);
  const turns = turnStats(steps);

  // Each agent's runs added up: researcher rounds together, every critic review, every report
  const byAgent = AGENT_ORDER.map((role) => ({
    role,
    usage: sumUsage(Object.entries(runUsage).flatMap(([id, u]) => (runRoles[id] === role ? [u] : []))),
  })).filter((a) => tokensOf(a.usage) > 0);

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
      <Stat
        label="Tokens"
        value={formatTokens(totalTokens)}
        detail={
          totalTokens > 0
            ? `${formatTokens(usage.outputTokens)} out${cacheHitRate != null ? ` · ${formatPercent(cacheHitRate)} cache hits` : ""}`
            : undefined
        }
      />
      <Stat
        label="Estimated cost"
        value={formatCost(usage.costUsd)}
        detail={
          turns.avgCostUsd != null
            ? `${formatCost(turns.avgCostUsd)}/turn avg · ${turns.turns} ${turns.turns === 1 ? "turn" : "turns"}`
            : undefined
        }
      />
      <Stat label="Searches" value={String(usage.searches)} />
      <Stat label="Pages read" value={String(usage.pagesRead)} />
      {(byAgent.length > 1 || turns.last) && (
        <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-1 bg-card px-4 py-2 text-xs sm:col-span-4">
          {byAgent.length > 1 && (
            <>
              <dt className="text-muted-foreground">By agent</dt>
              {byAgent.map(({ role, usage: u }) => (
                <dd key={role} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", AGENT_META[role].dot)} />
                  <span>{AGENT_META[role].label}</span>
                  <span className="text-muted-foreground">{formatCostTokens(u.costUsd, tokensOf(u))}</span>
                </dd>
              ))}
            </>
          )}
          {turns.last && (
            // One unit, so the label never wraps away from its value
            <dd className="whitespace-nowrap text-muted-foreground sm:ml-auto">
              Last turn {formatCostTokens(turns.last.costUsd ?? 0, turnTokens(turns.last))}
            </dd>
          )}
        </div>
      )}
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
