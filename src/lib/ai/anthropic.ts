import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ maxRetries: 4 }); // reads ANTHROPIC_API_KEY; retries 429/5xx with backoff

// Change models in one place. claude-opus-5-5 ($4 / $20 per MTok) is the most
// capable option if the researcher's planning isn't good enough on Sonnet.
export const MODELS = {
  researcher: "claude-sonnet-5-5", // $2 / $10 per MTok
  critic: "claude-haiku-5-5", // $0.10 / $0.50 per MTok
  writer: "claude-sonnet-5-5",
} as const;

export type Effort = NonNullable<Anthropic.Beta.BetaOutputConfig["effort"]>;

/**
 * Per-agent output limit and reasoning effort. max_tokens counts thinking too, so
 * keep it generous: a response cut off at the limit is thrown away. Medium effort
 * suits the researcher's many small tool-use turns and the critic's verdict; the
 * writer's one-shot synthesis gets high.
 */
export const MODEL_SETTINGS = {
  researcher: { maxTokens: 16_000, effort: "medium" },
  critic: { maxTokens: 16_000, effort: "medium" },
  writer: { maxTokens: 32_000, effort: "high" }, // thinking + a ~3000-word report
} as const satisfies Record<keyof typeof MODELS, { maxTokens: number; effort: Effort }>;

export const AGENT_BETAS = [
  "context-management-2025-06-27", // server-side clearing of old tool results
  "server-side-fallback-2026-07-01", // on a safety refusal, re-run on a fallback model instead of just stopping
];
