import { saveFindingTool } from "./note-taking";
import { evaluateProgressTool, updatePlanTool } from "./planning";
import { ToolRegistry } from "./registry";
import { webReadTool } from "./web-read";
import { webSearchTool } from "./web-search";

/** All researcher tools, in a fixed order (the order is part of the prompt cache key). */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(webSearchTool);
  registry.register(webReadTool);
  registry.register(saveFindingTool);
  registry.register(updatePlanTool);
  registry.register(evaluateProgressTool);
  return registry;
}

export { ToolRegistry };
