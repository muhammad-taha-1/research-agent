import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

// The loop calls client.beta.messages (for context editing), so use the beta tool type
export type ToolDefinition = Anthropic.Beta.BetaTool;

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

export interface AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  definition: ToolDefinition;
  inputSchema: S; // validated in registry.execute — a bad input becomes an error result, not a crash
  execute: (input: z.infer<S>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  projectId: string;
  runId: string;
  userId: string;
}

/** Identity helper so `execute` gets its input type inferred from `inputSchema`. */
export function defineTool<S extends z.ZodTypeAny>(tool: AgentTool<S>): AgentTool<S> {
  return tool;
}

export function ok(data: unknown): ToolResult {
  return { success: true, data };
}

export function fail(error: string): ToolResult {
  return { success: false, data: null, error };
}
