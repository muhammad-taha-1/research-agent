import type { FindingView } from "@/types/research";
import type { ResearchPlan, ToolResult } from "./types";

// Structured record of what the agent has done and learned, kept alongside the
// conversation. Phase 6 only records; Phase 10 adds duplicate detection and
// the context summary that seeds the next agent.

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

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export class AgentMemory {
  private searchQueries: string[] = [];
  private readUrls: Set<string> = new Set();
  private findings: FindingSummary[] = [];
  private plan: ResearchPlan | null = null;
  private lastEvaluation: Evaluation | null = null;

  /** Called after every tool call with what actually happened. Failures aren't recorded. */
  record(toolName: string, input: unknown, result: ToolResult): void {
    if (!result.success || get(result.data, "duplicate") === true) return;

    switch (toolName) {
      case "web_search": {
        const query = get(input, "query");
        if (typeof query === "string") this.searchQueries.push(query);
        break;
      }
      case "read_webpage": {
        const url = get(input, "url");
        if (typeof url === "string") this.readUrls.add(url);
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

  /** Returns an "already done" result for repeats, or null to run the tool. Phase 10. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until Phase 10
  checkDuplicate(_toolName: string, _input: unknown): ToolResult | null {
    return null;
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
    memory.readUrls = new Set(data.readUrls ?? []);
    memory.findings = data.findings ?? [];
    memory.plan = data.plan ?? null;
    memory.lastEvaluation = data.lastEvaluation ?? null;
    return memory;
  }
}
