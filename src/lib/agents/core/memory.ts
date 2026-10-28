import type { FindingView } from "@/types/research";
import { ok, type ResearchPlan, type ToolResult } from "./types";

// Structured record of what the agent has done and learned, kept alongside the
// conversation. It catches repeated searches, re-reads, and duplicate findings,
// and builds the summary that seeds the next agent (gap-fill round, critic, writer).
// The live conversation is never rebuilt from it: that would break the prompt cache.

export type FindingSummary = Pick<FindingView, "title" | "content" | "sourceUrl" | "category" | "relevance">;

export interface Evaluation {
  assessment: string;
  coverageScore: number;
  shouldContinue: boolean;
  reason: string;
}

export interface SerializedMemory {
  searchQueries: string[];
  readUrls: string[];
  findings: FindingSummary[];
  plan: ResearchPlan | null;
  lastEvaluation: Evaluation | null;
}

type DedupTool = "web_search" | "read_webpage" | "save_finding";

const SEARCH_REPEAT = 0.8; // word-set Jaccard with an earlier query
const TITLE_REPEAT = 0.85; // word-set Jaccard with an earlier finding's title
const TRACKING_PARAM = /^(utm_.*|fbclid|gclid)$/i;

// Summary decay: past DECAY_AFTER findings, only the most relevant and the most
// recent keep their content; the rest shrink to title + source.
const DECAY_AFTER = 30;
const KEEP_RECENT = 10;
const KEEP_TOP = 10;
const CONTENT_PREVIEW = 200;

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** True for the "already done" results checkDuplicate returns. */
export function isDuplicate(result: ToolResult): boolean {
  return result.success && get(result.data, "duplicate") === true;
}

/** Lowercased words, punctuation dropped: "EV  Sales, 2024" → ["ev", "sales", "2024"]. */
export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** Drops #fragment, tracking params, and trailing slashes, so variants of one page compare equal. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export class AgentMemory {
  private searchQueries: string[] = [];
  private readUrls: Set<string> = new Set(); // normalized
  private findings: FindingSummary[] = [];
  private plan: ResearchPlan | null = null;
  private lastEvaluation: Evaluation | null = null;

  // Calls from one turn run in parallel, so checkDuplicate claims each call it lets
  // through and record releases it: a repeat of a call still running is caught too.
  private inFlight: { tool: DedupTool; key: string }[] = [];

  // Token budget for summaries handed to the next agent
  private maxContextTokens = 8000;

  /** Called after every tool call with what actually happened. Failures and repeats aren't recorded. */
  record(toolName: string, input: unknown, result: ToolResult): void {
    if (isDuplicate(result)) return;
    this.release(toolName, input);
    if (!result.success) return;

    switch (toolName) {
      case "web_search": {
        const query = get(input, "query");
        if (typeof query === "string") this.searchQueries.push(query);
        break;
      }
      case "read_webpage": {
        const url = get(input, "url");
        if (typeof url === "string") this.readUrls.add(normalizeUrl(url));
        break;
      }
      case "save_finding": {
        const f = result.data as FindingView; // save_finding returns the saved row
        this.findings.push({
          title: f.title,
          content: f.content,
          sourceUrl: f.sourceUrl,
          category: f.category,
          relevance: f.relevance,
        });
        break;
      }
      case "update_plan": {
        const p = result.data;
        this.plan = {
          completed: strings(get(p, "completed")),
          inProgress: (get(p, "in_progress") as string | null) ?? "",
          remaining: strings(get(p, "remaining")),
          gaps: strings(get(p, "gaps")),
        };
        break;
      }
      case "evaluate_progress": {
        const e = result.data;
        this.lastEvaluation = {
          assessment: String(get(e, "assessment") ?? ""),
          coverageScore: Number(get(e, "coverage_score") ?? 0),
          shouldContinue: get(e, "should_continue") === true,
          reason: String(get(e, "reason") ?? ""),
        };
        break;
      }
    }
  }

  /**
   * Returns an "already done" result for repeats, or null to run the tool. A repeat
   * still gets a tool_result (every tool_use needs one), and the note steers the agent.
   */
  checkDuplicate(toolName: string, input: unknown): ToolResult | null {
    const key = dedupKey(toolName, input);
    if (!key) return null;

    switch (key.tool) {
      case "web_search": {
        const earlier = this.findSimilar(key, this.searchQueries, SEARCH_REPEAT);
        if (earlier === null) break;
        return ok({
          duplicate: true,
          note: `You already searched "${earlier}". This search wasn't run and doesn't count toward your target. Try a different angle.`,
        });
      }
      case "read_webpage": {
        if (!this.readUrls.has(key.key) && !this.isInFlight(key)) break;
        return ok({
          duplicate: true,
          note: `You already read ${key.key}. It wasn't read again and doesn't count toward your target. Use the findings you saved from it, or read a different source.`,
        });
      }
      case "save_finding": {
        const titles = this.findings.map((f) => f.title);
        const earlier = this.findSimilar(key, titles, TITLE_REPEAT);
        if (earlier === null) break;
        return ok({
          duplicate: true,
          note: `You already saved a finding titled "${earlier}", so this one wasn't saved. If it adds something new, save it with a title that says what's different.`,
        });
      }
    }

    this.inFlight.push(key);
    return null;
  }

  /**
   * Seeds a NEW conversation (gap-fill round) and feeds the critic and writer.
   * Gives up detail level by level until it fits the token budget.
   */
  buildContextSummary(opts: { maxTokens?: number } = {}): string {
    const maxTokens = opts.maxTokens ?? this.maxContextTokens;
    let summary = "";
    for (const level of [0, 1, 2] as const) {
      summary = this.renderSummary(level);
      if (estimateTokens(summary) <= maxTokens) return summary;
    }
    return `${summary.slice(0, maxTokens * 4).trimEnd()}\n…(summary truncated)`;
  }

  get searchCount(): number {
    return this.searchQueries.length;
  }

  get pagesRead(): number {
    return this.readUrls.size;
  }

  toJSON(): SerializedMemory {
    return {
      searchQueries: this.searchQueries,
      readUrls: [...this.readUrls],
      findings: this.findings,
      plan: this.plan,
      lastEvaluation: this.lastEvaluation,
    };
  }

  static fromJSON(data: SerializedMemory): AgentMemory {
    const memory = new AgentMemory();
    memory.searchQueries = data.searchQueries ?? [];
    memory.readUrls = new Set((data.readUrls ?? []).map(normalizeUrl)); // older checkpoints stored them raw
    memory.findings = data.findings ?? [];
    memory.plan = data.plan ?? null;
    memory.lastEvaluation = data.lastEvaluation ?? null;
    return memory;
  }

  /** The earlier text (done or still running) similar enough to count as a repeat, or null. */
  private findSimilar(key: { tool: DedupTool; key: string }, done: string[], threshold: number): string | null {
    const target = words(key.key);
    const running = this.inFlight.filter((c) => c.tool === key.tool).map((c) => c.key);
    return [...done, ...running].find((earlier) => jaccard(target, words(earlier)) >= threshold) ?? null;
  }

  private isInFlight(key: { tool: DedupTool; key: string }): boolean {
    return this.inFlight.some((c) => c.tool === key.tool && c.key === key.key);
  }

  private release(toolName: string, input: unknown): void {
    const key = dedupKey(toolName, input);
    if (!key) return;
    const i = this.inFlight.findIndex((c) => c.tool === key.tool && c.key === key.key);
    if (i !== -1) this.inFlight.splice(i, 1);
  }

  // Level 0: everything (findings decay past DECAY_AFTER). Level 1: findings always
  // decay, long lists keep their newest 30. Level 2: findings are titles only, lists keep 15.
  private renderSummary(level: 0 | 1 | 2): string {
    const sections: string[] = [];

    if (this.plan) {
      const { completed, inProgress, remaining, gaps } = this.plan;
      const lines = ["## Current Research Plan"];
      if (completed.length) lines.push(`Completed: ${completed.join(", ")}`);
      if (inProgress) lines.push(`In Progress: ${inProgress}`);
      if (remaining.length) lines.push(`Remaining: ${remaining.join(", ")}`);
      if (gaps.length) lines.push(`Knowledge Gaps: ${gaps.join(", ")}`);
      sections.push(lines.join("\n"));
    }

    if (this.lastEvaluation) {
      const { coverageScore, assessment } = this.lastEvaluation;
      sections.push(`## Last Self-Assessment (${Math.round(coverageScore * 100)}% coverage)\n${assessment}`);
    }

    const full = level === 2 ? new Set<number>() : this.findingsKeptInFull(level === 0 ? DECAY_AFTER : 0);
    const findingLines = this.findings.map((f, i) => {
      const source = f.sourceUrl ? `\n  Source: ${f.sourceUrl}` : "";
      const head = `- [${f.category || "general"}] ${f.title}`;
      return full.has(i) ? `${head}: ${clip(f.content, CONTENT_PREVIEW)}${source}` : `${head}${source}`;
    });
    sections.push([`## Findings (${this.findings.length} total)`, ...findingLines].join("\n"));

    const keep = level === 0 ? Infinity : level === 1 ? 30 : 15;
    sections.push(
      listSection(
        "Searches Performed (do not repeat these)",
        this.searchQueries.map((q) => `"${q}"`),
        keep,
      ),
    );
    sections.push(listSection("Pages Read (do not re-read these)", [...this.readUrls], keep));

    return sections.join("\n\n");
  }

  /** Indexes of findings that keep their content: all of them up to `decayAfter`, then the top and newest. */
  private findingsKeptInFull(decayAfter: number): Set<number> {
    const indexes = this.findings.map((_, i) => i);
    if (this.findings.length <= decayAfter) return new Set(indexes);

    const recent = indexes.slice(-KEEP_RECENT);
    const top = indexes
      .slice(0, -KEEP_RECENT)
      .sort((a, b) => (this.findings[b].relevance ?? 0) - (this.findings[a].relevance ?? 0))
      .slice(0, KEEP_TOP);
    return new Set([...top, ...recent]);
  }
}

function dedupKey(toolName: string, input: unknown): { tool: DedupTool; key: string } | null {
  const field = { web_search: "query", read_webpage: "url", save_finding: "title" }[toolName];
  const value = field ? get(input, field) : undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  const tool = toolName as DedupTool;
  return { tool, key: tool === "read_webpage" ? normalizeUrl(value) : value.trim().replace(/\s+/g, " ") };
}

/** A bulleted section that keeps the newest `keep` items and counts the rest. */
function listSection(heading: string, items: string[], keep: number): string {
  const shown = items.slice(-keep);
  const lines = [`## ${heading}`, ...shown.map((item) => `- ${item}`)];
  if (items.length > shown.length) lines.push(`- …and ${items.length - shown.length} earlier`);
  if (items.length === 0) lines.push("- (none)");
  return lines.join("\n");
}
