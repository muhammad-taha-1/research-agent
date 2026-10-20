import { z } from "zod";
import {
  fail,
  type AgentTool,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "@/lib/agents/core/types";

// Central registry of all available tools. The agent loop asks it for the
// definitions to send Claude, and executes tool calls through it by name.
export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  register(tool: AgentTool): void {
    const { name } = tool.definition;
    if (this.tools.has(name)) throw new Error(`Tool "${name}" is already registered`);
    this.tools.set(name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Registration order, every time: the tool list is the start of the prompt cache prefix. */
  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  // Never throws: unknown tool, invalid input (Zod), or an exception inside the tool
  // all come back as { success: false, error } so the agent can reason about the failure
  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return fail(`Unknown tool "${name}". Available tools: ${[...this.tools.keys()].join(", ")}`);
    }

    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(`Invalid input for ${name}:\n${z.prettifyError(parsed.error)}`);
    }

    try {
      return await tool.execute(parsed.data, context);
    } catch (error) {
      console.error(`[tools] ${name} threw`, error);
      return fail(`${name} failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
