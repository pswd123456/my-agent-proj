import type { AnthropicToolDefinition } from "../model.js";

import { createListDirectoryTool } from "./list-directory.js";
import { createReadFileTool } from "./read-file.js";
import { createSearchTextTool } from "./search-text.js";
import type { RuntimeTool } from "./runtime-tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, RuntimeTool>();

  register(tool: RuntimeTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): RuntimeTool | undefined {
    return this.tools.get(name);
  }

  list(): RuntimeTool[] {
    return [...this.tools.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  toAnthropicTools(): AnthropicToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }
}

export function createDefaultToolRegistry(options: {
  workingDirectory: string;
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createReadFileTool(options.workingDirectory));
  registry.register(createListDirectoryTool(options.workingDirectory));
  registry.register(createSearchTextTool(options.workingDirectory));
  return registry;
}
