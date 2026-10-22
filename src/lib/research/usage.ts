import type { UsageView } from "@/types/research";

const ZERO_USAGE: UsageView = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  searches: 0,
  pagesRead: 0,
};

/** Project totals from per-run usage. The live view uses it too, as usage events arrive. */
export function sumUsage(usages: UsageView[]): UsageView {
  return usages.reduce(
    (u, r) => ({
      inputTokens: u.inputTokens + r.inputTokens,
      outputTokens: u.outputTokens + r.outputTokens,
      cacheReadTokens: u.cacheReadTokens + r.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens + r.cacheWriteTokens,
      costUsd: u.costUsd + r.costUsd,
      searches: u.searches + r.searches,
      pagesRead: u.pagesRead + r.pagesRead,
    }),
    ZERO_USAGE,
  );
}
