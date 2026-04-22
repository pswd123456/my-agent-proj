import type { AnthropicToolDefinition } from "../model.js";

import type { RoutineRepository } from "@ai-app-template/db";

import { createAskForConfirmationTool } from "./ask-for-confirmation.js";
import { createCopyPathTool } from "./copy-path.js";
import { createCreateDirectoryTool } from "./create-directory.js";
import { createCreateRoutineTool } from "./create-routine.js";
import { createDeletePathTool } from "./delete-path.js";
import { createDeleteRoutineTool } from "./delete-routine.js";
import { createEditRoutineTool } from "./edit-routine.js";
import { createListRoutineByDateTool } from "./list-routine-by-date.js";
import { createListRoutineByWeekTool } from "./list-routine-by-week.js";
import { createListDirectoryTool } from "./list-directory.js";
import { createMakeHttpRequestTool } from "./make-http-request.js";
import { createMovePathTool } from "./move-path.js";
import { createReadFileTool } from "./read-file.js";
import { createRunShellCommandTool } from "./run-shell-command.js";
import { createSearchRoutineByOclockTool } from "./search-routine-by-oclock.js";
import { createSearchTextTool } from "./search-text.js";
import { createWriteFileTool } from "./write-file.js";
import type { RuntimeTool } from "./runtime-tool.js";

function validateToolDefinition(tool: RuntimeTool): void {
  if (!tool.name.trim()) {
    throw new Error("Tool name is required.");
  }
  if (!tool.description.trim()) {
    throw new Error(`Tool description is required for ${tool.name}.`);
  }
  if (
    typeof tool.hasExternalSideEffect !== "boolean" ||
    typeof tool.isReadOnly !== "boolean"
  ) {
    throw new Error(
      `Tool ${tool.name} must declare isReadOnly and hasExternalSideEffect.`
    );
  }
  if (
    tool.permissionProfile === "destructive-only" &&
    typeof tool.getPermissionRequest !== "function"
  ) {
    throw new Error(
      `Tool ${tool.name} must implement getPermissionRequest() for destructive-only permission checks.`
    );
  }
  if (
    tool.sandboxProfile === "workspace-rooted" &&
    typeof tool.getSandboxTargets !== "function"
  ) {
    throw new Error(
      `Tool ${tool.name} must implement getSandboxTargets() for workspace-rooted sandbox checks.`
    );
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, RuntimeTool>();

  register(tool: RuntimeTool): this {
    validateToolDefinition(tool);
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }
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

function registerTools(registry: ToolRegistry, tools: RuntimeTool[]): ToolRegistry {
  for (const tool of tools) {
    registry.register(tool);
  }

  return registry;
}

export function createWorkspaceToolRegistry(options: {
  workingDirectory: string;
}): ToolRegistry {
  return registerTools(new ToolRegistry(), [
    createReadFileTool(options.workingDirectory),
    createListDirectoryTool(options.workingDirectory),
    createSearchTextTool(options.workingDirectory),
    createWriteFileTool(options.workingDirectory),
    createCreateDirectoryTool(options.workingDirectory),
    createDeletePathTool(options.workingDirectory),
    createMovePathTool(options.workingDirectory),
    createCopyPathTool(options.workingDirectory),
    createRunShellCommandTool(),
    createMakeHttpRequestTool()
  ]);
}

export function createScheduleToolRegistry(options: {
  routineRepository: RoutineRepository;
}): ToolRegistry {
  void options;
  return registerTools(new ToolRegistry(), [
    createCreateRoutineTool(),
    createEditRoutineTool(),
    createDeleteRoutineTool(),
    createSearchRoutineByOclockTool(),
    createListRoutineByWeekTool(),
    createListRoutineByDateTool(),
    createAskForConfirmationTool()
  ]);
}

export function createDefaultToolRegistry(options: {
  workingDirectory: string;
  routineRepository: RoutineRepository;
}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of createWorkspaceToolRegistry(options).list()) {
    registry.register(tool);
  }
  for (const tool of createScheduleToolRegistry(options).list()) {
    registry.register(tool);
  }

  return registry;
}
