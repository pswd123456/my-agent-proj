import type { AnthropicToolDefinition } from "../model.js";

import type { RoutineRepository } from "@ai-app-template/db";

import { createAskForConfirmationTool } from "./ask-for-confirmation.js";
import { createCreateRoutineTool } from "./create-routine.js";
import { createDeleteRoutineTool } from "./delete-routine.js";
import { createEditRoutineTool } from "./edit-routine.js";
import { createListRoutineByDateTool } from "./list-routine-by-date.js";
import { createListRoutineByWeekTool } from "./list-routine-by-week.js";
import { createListDirectoryTool } from "./list-directory.js";
import { createReadFileTool } from "./read-file.js";
import { createSearchRoutineByOclockTool } from "./search-routine-by-oclock.js";
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

export function createWorkspaceToolRegistry(options: {
  workingDirectory: string;
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createReadFileTool(options.workingDirectory));
  registry.register(createListDirectoryTool(options.workingDirectory));
  registry.register(createSearchTextTool(options.workingDirectory));
  return registry;
}

export function createScheduleToolRegistry(options: {
  routineRepository: RoutineRepository;
}): ToolRegistry {
  void options;
  const registry = new ToolRegistry();
  registry.register(createCreateRoutineTool());
  registry.register(createEditRoutineTool());
  registry.register(createDeleteRoutineTool());
  registry.register(createSearchRoutineByOclockTool());
  registry.register(createListRoutineByWeekTool());
  registry.register(createListRoutineByDateTool());
  registry.register(createAskForConfirmationTool());
  return registry;
}
