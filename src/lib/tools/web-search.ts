import { tavily, type TavilyClient } from "@tavily/core";
import { z } from "zod";
import { defineTool, fail, ok, type ToolResult } from "@/lib/agents/core/types";

const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 10;
const SNIPPET_MAX = 600; // chars; read_webpage is for the full text

// Created on first use rather than at import, so scripts can load .env.local first.
let client: TavilyClient | null = null;
function getClient(): TavilyClient {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  client ??= tavily({ apiKey });
  return client;
}

const inputSchema = z.object({
  query: z.string().trim().min(1, "Query is empty").max(400),
  max_results: z.number().int().positive().optional(),
});

export const webSearchTool = defineTool({
  definition: {
    name: "web_search",
    description:
      "Search the web for information on a topic. Returns titles, URLs, and snippets from the top results. Use specific, targeted queries for best results. Break broad topics into multiple focused searches.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. Be specific and focused.",
        },
        max_results: {
          type: "number",
          description: `Number of results to return (default: ${DEFAULT_RESULTS}, max: ${MAX_RESULTS})`,
        },
      },
      required: ["query"],
    },
  },
  inputSchema,
  async execute({ query, max_results }) {
    const maxResults = Math.min(max_results ?? DEFAULT_RESULTS, MAX_RESULTS);
    try {
      const response = await withRateLimitBackoff(() => getClient().search(query, { maxResults, timeout: 20 }));
      const results = response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content.length > SNIPPET_MAX ? `${r.content.slice(0, SNIPPET_MAX)}…` : r.content,
        relevance_score: Math.round(r.score * 100) / 100,
        ...(r.publishedDate ? { published_date: r.publishedDate } : {}),
      }));
      if (results.length === 0) {
        return ok({ query, results, note: "No results. Try a broader or differently worded query." });
      }
      return ok({ query, results });
    } catch (error) {
      return searchFailure(error);
    }
  },
});

// @tavily/core throws plain Errors carrying the HTTP status or Tavily's detail
// message, so the message text is all there is to classify on.
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
// 429: too many requests right now. 432/433: the plan's or pay-as-you-go quota is
// used up, which waiting a few seconds won't change.
const QUOTA_EXCEEDED = /\b(432|433)\b|usage limit|exceeds your plan|plan limit/i;
const RATE_LIMITED = /\b429\b|rate limit|too many requests|excessive requests/i;
const isTemporaryRateLimit = (message: string) => RATE_LIMITED.test(message) && !QUOTA_EXCEEDED.test(message);

/** Waits between retries of a rate-limited search: 1s, 2s, then 4s. */
export const SEARCH_BACKOFF_MS = [1000, 2000, 4000];

/** Runs a search, retrying with exponential backoff while Tavily answers 429. */
async function withRateLimitBackoff<T>(search: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await search();
    } catch (error) {
      const wait = SEARCH_BACKOFF_MS[attempt];
      if (wait === undefined || !isTemporaryRateLimit(errorMessage(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

function searchFailure(error: unknown): ToolResult {
  const message = errorMessage(error);
  if (QUOTA_EXCEEDED.test(message)) {
    return fail(
      `The search quota is used up (${message}). Web search is unavailable for now: continue with the sources you already have.`,
      "RATE_LIMIT",
    );
  }
  if (isTemporaryRateLimit(message)) {
    return fail(
      `Search is rate-limited, still after ${SEARCH_BACKOFF_MS.length} retries (${message}). Read pages you already found before searching again.`,
      "RATE_LIMIT",
    );
  }
  if (/timed out/i.test(message)) {
    return fail("Search timed out. Retry once, or rephrase the query.", "NETWORK_ERROR");
  }
  if (/\b401\b|unauthorized|invalid api key|TAVILY_API_KEY/i.test(message)) {
    return fail(`Search is not configured correctly (${message}). Web search is unavailable for this run.`);
  }
  return fail(`Search failed: ${message}`, /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message) ? "NETWORK_ERROR" : undefined);
}
