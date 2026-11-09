import Anthropic from "@anthropic-ai/sdk";
import type { ErrorType } from "@/generated/prisma/enums";

// Every failure gets one category, so the run view can show where agents fail most:
// many RATE_LIMITs mean the agent searches too fast, many URL_BLOCKEDs that it picks
// sites that refuse bots, and so on. Tools set the category where they fail (they
// know why); Claude API errors and stop reasons are categorized here.

/** A Claude API call that threw. The SDK has already retried 429/5xx and connection errors. */
export function categorizeApiError(error: unknown): ErrorType {
  // APIConnectionError (timeouts included) subclasses APIError, so check it first
  if (error instanceof Anthropic.APIConnectionError) return "NETWORK_ERROR";
  if (error instanceof Anthropic.RateLimitError) return "RATE_LIMIT";
  if (error instanceof Anthropic.BadRequestError && /prompt is too long|context window/i.test(error.message)) {
    return "CONTEXT_OVERFLOW"; // a 400 invalid_request_error; only the message tells it apart
  }
  if (error instanceof Anthropic.APIError) return "API_ERROR";
  if (error instanceof Anthropic.AnthropicError) return "PARSE_ERROR"; // e.g. structured output that didn't parse
  return "API_ERROR";
}

/** A response that came back but can't be used, or null when the stop reason is fine. */
export function categorizeStopReason(stopReason: string | null): ErrorType | null {
  switch (stopReason) {
    case "refusal":
      return "REFUSAL";
    case "max_tokens":
      return "MAX_TOKENS";
    case "model_context_window_exceeded":
      return "CONTEXT_OVERFLOW";
    default:
      return null;
  }
}
