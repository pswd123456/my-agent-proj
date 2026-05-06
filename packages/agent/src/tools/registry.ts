import type { AnthropicToolDefinition } from "../model.js";

import {
  DEFAULT_CAPABILITY_PACKS,
  type CapabilityPackName,
  type SettingsPermissionToolOption,
  type WorkspaceSkillSettingRecord
} from "@ai-app-template/domain";

import type { LspServerManager } from "../lsp/index.js";
import { createAskForConfirmationTool } from "./ask-for-confirmation.js";
import { createAskUserQuestionTool } from "./ask-user-question.js";
import { createCreateDirectoryTool } from "./create-directory.js";
import { createDelegateAgentTool } from "./delegate-agent.js";
import { createDeleteFileTool } from "./delete-file.js";
import { createDeletePathTool } from "./delete-path.js";
import { createEditFileTool } from "./edit-file.js";
import { createGetCurrentTimeTool } from "./get-current-time.js";
import { createFindFilesTool } from "./find-files.js";
import { createGitDiffTool } from "./git-diff.js";
import { createGitStatusTool } from "./git-status.js";
import { createListDirectoryTool } from "./list-directory.js";
import { createLoadSkillTool } from "./load-skill.js";
import { createLspTools } from "./lsp.js";
import { createManageCapabilityPacksTool } from "./manage-capability-packs.js";
import { createManageCronJobsTool } from "./manage-cron-jobs.js";
import { createManageRoutineTool } from "./manage-routine.js";
import {
  createManageTelegramChatTool,
  type CreateManageTelegramChatToolOptions
} from "./manage-telegram-chat.js";
import { createManageTaskBriefTool } from "./manage-task-brief.js";
import { createManageTodoListTool } from "./manage-todo-list.js";
import { createManagePathTool } from "./manage-path.js";
import { createMakeHttpRequestTool } from "./make-http-request.js";
import { createMemorySearchTool } from "./memory-search.js";
import { createQueryRoutinesTool } from "./query-routines.js";
import { createReadFileTool } from "./read-file.js";
import { createRunShellCommandTool } from "./run-shell-command.js";
import { createSearchSkillTool } from "./search-skill.js";
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
    createGetCurrentTimeTool(),
    createManageCapabilityPacksTool(),
    createManageTaskBriefTool(),
    createManageTodoListTool()
  ]);
}

export function createWorkspaceToolRegistry(options: {
  workingDirectory: string;
  workspaceSkillSettings?: readonly WorkspaceSkillSettingRecord[];
}): ToolRegistry {
  return registerTools(new ToolRegistry(), [
    createReadFileTool(options.workingDirectory),
    createListDirectoryTool(options.workingDirectory),
    createFindFilesTool(options.workingDirectory),
    createSearchTextTool(options.workingDirectory),
    createEditFileTool(options.workingDirectory),
    createWriteFileTool(options.workingDirectory),
    createCreateDirectoryTool(options.workingDirectory),
    createDeleteFileTool(options.workingDirectory),
    createDeletePathTool(options.workingDirectory),
    createManagePathTool(options.workingDirectory),
    createGitStatusTool(),
    createGitDiffTool(),
    createRunShellCommandTool(),
    createMakeHttpRequestTool(),
    createMemorySearchTool(),
    createSearchSkillTool(
      options.workingDirectory,
      options.workspaceSkillSettings
    ),
    createLoadSkillTool(
      options.workingDirectory,
      options.workspaceSkillSettings
    )
  ]);
}

export function createScheduleToolRegistry(): ToolRegistry {
  return registerTools(new ToolRegistry(), [
    createManageCronJobsTool(),
    createManageRoutineTool(),
    createQueryRoutinesTool(),
    createAskForConfirmationTool()
  ]);
}

export function createLspToolRegistry(options: {
  workingDirectory: string;
  lspServerManager?: LspServerManager;
}): ToolRegistry {
  return registerTools(new ToolRegistry(), createLspTools(options));
}

export function createDefaultToolRegistry(options: {
  workingDirectory: string;
  lspServerManager?: LspServerManager;
  enabledCapabilityPacks?: readonly string[];
  workspaceSkillSettings?: readonly WorkspaceSkillSettingRecord[];
  env?: NodeJS.ProcessEnv;
  telegramChatTool?: CreateManageTelegramChatToolOptions;
}): ToolRegistry {
  const registry = createPlanningToolRegistry();
  const enabled = new Set(
    options.enabledCapabilityPacks ?? DEFAULT_CAPABILITY_PACKS
  );

  registry.register(
    createManageTelegramChatTool({
      ...(options.env ? { env: options.env } : {}),
      ...options.telegramChatTool
    })
  );

  if (enabled.has("workspace")) {
    for (const tool of createWorkspaceToolRegistry(options).list()) {
      registry.register(tool);
    }
  }
  if (enabled.has("schedule")) {
    for (const tool of createScheduleToolRegistry().list()) {
      registry.register(tool);
    }
  }
  if (enabled.has("lsp")) {
    for (const tool of createLspToolRegistry(options).list()) {
      registry.register(tool);
    }
  }
  return registry;
}

export function listSettingsPermissionToolOptions(options: {
  workingDirectory: string;
}): SettingsPermissionToolOption[] {
  const tools = new Map<string, SettingsPermissionToolOption>();

  for (const tool of createPlanningToolRegistry().list()) {
    const option = toSettingsPermissionToolOption(tool, null);
    if (option) {
      tools.set(option.name, option);
    }
  }

  const telegramOption = toSettingsPermissionToolOption(
    createManageTelegramChatTool(),
    null
  );
  if (telegramOption) {
    tools.set(telegramOption.name, telegramOption);
  }

  for (const tool of createWorkspaceToolRegistry(options).list()) {
    const option = toSettingsPermissionToolOption(tool, "workspace");
    if (option) {
      tools.set(option.name, option);
    }
  }

  for (const tool of createScheduleToolRegistry().list()) {
    const option = toSettingsPermissionToolOption(tool, "schedule");
    if (option) {
      tools.set(option.name, option);
    }
  }

  for (const tool of createLspToolRegistry(options).list()) {
    const option = toSettingsPermissionToolOption(tool, "lsp");
    if (option) {
      tools.set(option.name, option);
    }
  }

  return [...tools.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}
