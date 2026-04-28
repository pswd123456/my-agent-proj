import type { AnthropicToolDefinition } from "../model.js";

import type { RoutineRepository } from "@ai-app-template/db";
import type {
  CapabilityPackName,
  SettingsPermissionToolOption
} from "@ai-app-template/domain";

import { createApplyPatchTool } from "./apply-patch.js";
import { createAskForConfirmationTool } from "./ask-for-confirmation.js";
import { createAskUserQuestionTool } from "./ask-user-question.js";
import { createCopyPathTool } from "./copy-path.js";
import { createCreateDirectoryTool } from "./create-directory.js";
import { createCreateRoutineTool } from "./create-routine.js";
import { createDelegateAgentTool } from "./delegate-agent.js";
import { createDeletePathTool } from "./delete-path.js";
import { createDeleteRoutineTool } from "./delete-routine.js";
import { createEditTaskBriefTool } from "./edit-task-brief.js";
import { createEditRoutineTool } from "./edit-routine.js";
import { createGetTodoListTool } from "./get-todo-list.js";
import { createGetTaskBriefTool } from "./get-task-brief.js";
import { createFindFilesTool } from "./find-files.js";
import {
  createGitDiffCachedTool,
  createGitDiffToolUncached
} from "./git-diff.js";
import { createGitStatusTool } from "./git-status.js";
import { createListRoutineByDateTool } from "./list-routine-by-date.js";
import { createListRoutineByWeekTool } from "./list-routine-by-week.js";
import { createListDirectoryTool } from "./list-directory.js";
import { createLoadSkillTool } from "./load-skill.js";
import { createManageCapabilityPacksTool } from "./manage-capability-packs.js";
import { createMakeHttpRequestTool } from "./make-http-request.js";
import { createMovePathTool } from "./move-path.js";
import { createReadFileTool } from "./read-file.js";
import { createReadTaskBriefTool } from "./read-task-brief.js";
import { createReplaceTodoListTool } from "./replace-todo-list.js";
import { createReplaceTaskBriefTool } from "./replace-task-brief.js";
import { createRunShellCommandTool } from "./run-shell-command.js";
import { createSearchRoutineByOclockTool } from "./search-routine-by-oclock.js";
import { createSearchSkillTool } from "./search-skill.js";
import { createSearchTaskBriefTool } from "./search-task-brief.js";
import { createSearchTextTool } from "./search-text.js";
import { createUpdateTodoItemsTool } from "./update-todo-items.js";
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

function registerTools(
  registry: ToolRegistry,
  tools: RuntimeTool[]
): ToolRegistry {
  for (const tool of tools) {
    registry.register(tool);
  }

  return registry;
}

function toSettingsPermissionToolOption(
  tool: RuntimeTool,
  capabilityPack: CapabilityPackName | null
): SettingsPermissionToolOption | null {
  if (
    tool.family === "workspace-shell" ||
    tool.family === "workspace-network"
  ) {
    return null;
  }

  return {
    name: tool.name,
    family: tool.family,
    capabilityPack
  };
}

export function createPlanningToolRegistry(): ToolRegistry {
  return registerTools(new ToolRegistry(), [
    createAskUserQuestionTool(),
    createDelegateAgentTool(),
    createEditTaskBriefTool(),
    createGetTaskBriefTool(),
    createGetTodoListTool(),
    createManageCapabilityPacksTool(),
    createReadTaskBriefTool(),
    createReplaceTaskBriefTool(),
    createReplaceTodoListTool(),
    createSearchTaskBriefTool(),
    createUpdateTodoItemsTool()
  ]);
}

export function createWorkspaceToolRegistry(options: {
  workingDirectory: string;
}): ToolRegistry {
  return registerTools(new ToolRegistry(), [
    createApplyPatchTool(options.workingDirectory),
    createReadFileTool(options.workingDirectory),
    createListDirectoryTool(options.workingDirectory),
    createFindFilesTool(options.workingDirectory),
    createSearchTextTool(options.workingDirectory),
    createWriteFileTool(options.workingDirectory),
    createCreateDirectoryTool(options.workingDirectory),
    createDeletePathTool(options.workingDirectory),
    createMovePathTool(options.workingDirectory),
    createCopyPathTool(options.workingDirectory),
    createGitStatusTool(),
    createGitDiffToolUncached(),
    createGitDiffCachedTool(),
    createRunShellCommandTool(),
    createMakeHttpRequestTool(),
    createSearchSkillTool(options.workingDirectory),
    createLoadSkillTool(options.workingDirectory)
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
  enabledCapabilityPacks?: readonly string[];
}): ToolRegistry {
  const registry = createPlanningToolRegistry();
  const enabled = new Set(
    options.enabledCapabilityPacks ??
      (["workspace", "schedule"] satisfies CapabilityPackName[])
  );

  if (enabled.has("workspace")) {
    for (const tool of createWorkspaceToolRegistry(options).list()) {
      registry.register(tool);
    }
  }
  if (enabled.has("schedule")) {
    for (const tool of createScheduleToolRegistry(options).list()) {
      registry.register(tool);
    }
  }

  return registry;
}

export function listSettingsPermissionToolOptions(options: {
  workingDirectory: string;
  routineRepository: RoutineRepository;
}): SettingsPermissionToolOption[] {
  const tools = new Map<string, SettingsPermissionToolOption>();

  for (const tool of createPlanningToolRegistry().list()) {
    const option = toSettingsPermissionToolOption(tool, null);
    if (option) {
      tools.set(option.name, option);
    }
  }

  for (const tool of createWorkspaceToolRegistry(options).list()) {
    const option = toSettingsPermissionToolOption(tool, "workspace");
    if (option) {
      tools.set(option.name, option);
    }
  }

  for (const tool of createScheduleToolRegistry(options).list()) {
    const option = toSettingsPermissionToolOption(tool, "schedule");
    if (option) {
      tools.set(option.name, option);
    }
  }

  return [...tools.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}
