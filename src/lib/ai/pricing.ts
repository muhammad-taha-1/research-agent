import type Anthropic from "@anthropic-ai/sdk";

// $ per million tokens. Check current pricing before relying on these.
// Cache writes are 1.25x input (5-minute cache); cache reads are much cheaper than input.
// Haiku cache rates below assume the standard 1.25x / 0.1x multipliers.
export const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }, // prompts ≤100K tokens
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

/** Price a response by `response.model` (the model that served it), not the one requested. */
export function calculateCost(model: string, usage: Anthropic.Beta.BetaUsage): number {
  const p = PRICING[model];
  if (!p) {
    console.warn(`[pricing] no price for model "${model}"; counting $0`);
    return 0;
  }
  return (
    (usage.input_tokens * p.input + // uncached input
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      usage.output_tokens * p.output) / // includes thinking
    1_000_000
  );
}
