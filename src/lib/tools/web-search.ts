import { tavily, type TavilyClient } from "@tavily/core";
import { z } from "zod";
import { defineTool, fail, ok } from "@/lib/agents/core/types";

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
      const response = await getClient().search(query, { maxResults, timeout: 20 });
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
      return fail(describeSearchError(error));
    }
  },
});

// @tavily/core throws plain Errors carrying the HTTP status or Tavily's detail
// message, so the message text is all there is to classify on.
function describeSearchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(429|432|433)\b|rate limit|usage limit|exceeds your plan/i.test(message)) {
    return `Search rate limit or quota reached (${message}). Wait before searching again, or continue with the sources you already have.`;
  }
  if (/timed out/i.test(message)) {
    return "Search timed out. Retry once, or rephrase the query.";
  }
  if (/\b401\b|unauthorized|invalid api key|TAVILY_API_KEY/i.test(message)) {
    return `Search is not configured correctly (${message}). Web search is unavailable for this run.`;
  }
  return `Search failed: ${message}`;
}
