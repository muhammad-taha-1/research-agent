import {
  Bookmark,
  Brain,
  CornerDownRight,
  FileText,
  Gauge,
  ListChecks,
  PenLine,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { StepType } from "@/generated/prisma/enums";
import { hostname } from "@/lib/format";
import type { AgentStepView } from "@/types/research";

// Color is identity for the icon mark only; step text stays in text tokens.
// Spec palette: blue search, green read, yellow think, purple note.
export const STEP_META: Record<StepType, { label: string; icon: LucideIcon; tone: string }> = {
  SEARCH: { label: "Search", icon: Search, tone: "text-sky-400 bg-sky-400/10 ring-sky-400/30" },
  READ: { label: "Read", icon: FileText, tone: "text-emerald-400 bg-emerald-400/10 ring-emerald-400/30" },
  THINK: { label: "Think", icon: Brain, tone: "text-amber-300 bg-amber-300/10 ring-amber-300/30" },
  NOTE: { label: "Note", icon: Bookmark, tone: "text-violet-400 bg-violet-400/10 ring-violet-400/30" },
  PLAN: { label: "Plan", icon: ListChecks, tone: "text-cyan-300 bg-cyan-300/10 ring-cyan-300/30" },
  EVALUATE: { label: "Evaluate", icon: Gauge, tone: "text-teal-300 bg-teal-300/10 ring-teal-300/30" },
  REDIRECT: { label: "Redirect", icon: CornerDownRight, tone: "text-orange-400 bg-orange-400/10 ring-orange-400/30" },
  REVIEW: { label: "Review", icon: ShieldCheck, tone: "text-rose-400 bg-rose-400/10 ring-rose-400/30" },
  WRITE: { label: "Write", icon: PenLine, tone: "text-fuchsia-400 bg-fuchsia-400/10 ring-fuchsia-400/30" },
};

/** Safe field access on tool input/result JSON, whose shape the UI can't trust. */
export function field<T = unknown>(obj: unknown, key: string): T | undefined {
  return obj && typeof obj === "object" && key in obj
    ? ((obj as Record<string, unknown>)[key] as T)
    : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function firstLine(text: string, max = 120): string {
  const line = text.trim().split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** web_search returns an array, or { results: [...] } — count either. */
export function resultCount(result: unknown): number | undefined {
  const list = Array.isArray(result) ? result : field(result, "data") ?? field(result, "results");
  if (Array.isArray(list)) return list.length;
  const nested = field(list, "results");
  return Array.isArray(nested) ? nested.length : undefined;
}

/** One line for the timeline: what the agent did in this step. */
export function summarizeStep(step: AgentStepView): string {
  const input = step.toolInput;
  // Agent memory answered a repeat without running the tool
  const repeat = field(field(step.toolResult, "data"), "duplicate") === true;
  switch (step.type) {
    case "SEARCH": {
      const query = str(field(input, "query"));
      if (repeat) return query ? `Skipped repeat search “${query}”` : "Skipped a repeat search";
      return query ? `Searched “${query}”` : "Searched the web";
    }
    case "READ": {
      const url = str(field(input, "url"));
      if (repeat) return url ? `Skipped re-reading ${hostname(url)}` : "Skipped re-reading a page";
      return url ? `Read ${hostname(url)}` : "Read a page";
    }
    case "NOTE": {
      const title = str(field(input, "title"));
      if (repeat) return title ? `Skipped duplicate finding: ${title}` : "Skipped a duplicate finding";
      return title ? `Noted: ${title}` : "Saved a finding";
    }
    case "PLAN": {
      const now = str(field(input, "in_progress")) ?? str(field(input, "inProgress"));
      return now ? `Plan updated — now: ${now}` : "Updated the research plan";
    }
    case "EVALUATE": {
      const score = field<number>(input, "coverage_score");
      return typeof score === "number"
        ? `Evaluated progress — ${Math.round(score * 100)}% coverage`
        : "Evaluated progress";
    }
    case "REDIRECT":
      return `Operator instruction: ${firstLine(step.reasoning ?? str(field(input, "instruction")) ?? "")}`;
    case "REVIEW":
      return "Critic reviewed the findings";
    case "WRITE":
      return "Wrote the report";
    case "THINK":
      return step.reasoning ? firstLine(step.reasoning) : "Thinking";
  }
}

/** One line for a tool call that's still running: what the agent is doing right now. */
export function describeToolCall(tool: string, input: unknown): string {
  switch (tool) {
    case "web_search": {
      const query = str(field(input, "query"));
      return query ? `Searching “${query}”` : "Searching the web";
    }
    case "read_webpage": {
      const url = str(field(input, "url"));
      return url ? `Reading ${hostname(url)}` : "Reading a page";
    }
    case "save_finding": {
      const title = str(field(input, "title"));
      return title ? `Saving: ${title}` : "Saving a finding";
    }
    case "update_plan":
      return "Updating the research plan";
    case "evaluate_progress":
      return "Evaluating progress";
    default:
      return `Running ${tool}`;
  }
}
