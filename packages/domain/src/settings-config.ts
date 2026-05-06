import type { SessionSettingsRecord } from "./session-settings.js";
import type { UserContextHookRecord } from "./user-context-hooks.js";
import type { WorkspaceSkillSettingRecord } from "./workspace-skills.js";

export interface SettingsConfigRecord extends SessionSettingsRecord {
  channels?: {
    telegram?: {
      enabled?: boolean;
      mode?: "polling" | "webhook";
      botToken?: string;
      webhookSecret?: string;
      webhookUrl?: string;
    };
  };
  mcpServers?: Record<string, unknown>;
}

function pickDefinedArray<T>(value: T[] | undefined): T[] | undefined {
  return Array.isArray(value) ? [...value] : undefined;
}

export function mergeSettingsConfigRecords(input: {
  global: SessionSettingsRecord;
  workspace?: Partial<SettingsConfigRecord> | null;
}): SettingsConfigRecord {
  const workspace = input.workspace ?? {};

  return {
    workingDirectory:
      typeof workspace.workingDirectory === "string"
        ? workspace.workingDirectory
        : input.global.workingDirectory,
    model:
      typeof workspace.model === "string"
        ? workspace.model
        : input.global.model,
    thinkingEffort: workspace.thinkingEffort ?? input.global.thinkingEffort,
    yoloMode:
      typeof workspace.yoloMode === "boolean"
        ? workspace.yoloMode
        : input.global.yoloMode,
    contextWindow:
      typeof workspace.contextWindow === "number"
        ? workspace.contextWindow
        : input.global.contextWindow,
    maxTurns:
      typeof workspace.maxTurns === "number"
        ? workspace.maxTurns
        : input.global.maxTurns,
    shellAllowPatterns:
      pickDefinedArray(workspace.shellAllowPatterns) ??
      input.global.shellAllowPatterns,
    shellDenyPatterns:
      pickDefinedArray(workspace.shellDenyPatterns) ??
      input.global.shellDenyPatterns,
    toolAllowList:
      pickDefinedArray(workspace.toolAllowList) ?? input.global.toolAllowList,
    toolAskList:
      pickDefinedArray(workspace.toolAskList) ?? input.global.toolAskList,
    toolDenyList:
      pickDefinedArray(workspace.toolDenyList) ?? input.global.toolDenyList,
    enabledCapabilityPacks:
      pickDefinedArray(workspace.enabledCapabilityPacks) ??
      input.global.enabledCapabilityPacks,
    workspaceSkillSettings:
      (pickDefinedArray(
        workspace.workspaceSkillSettings as
          | WorkspaceSkillSettingRecord[]
          | undefined
      ) as WorkspaceSkillSettingRecord[] | undefined) ??
      input.global.workspaceSkillSettings,
    userContextHooks:
      (pickDefinedArray(
        workspace.userContextHooks as UserContextHookRecord[] | undefined
      ) as UserContextHookRecord[] | undefined) ??
      input.global.userContextHooks,
    debugConversationView:
      typeof workspace.debugConversationView === "boolean"
        ? workspace.debugConversationView
        : input.global.debugConversationView,
    memoryEnabled:
      typeof workspace.memoryEnabled === "boolean"
        ? workspace.memoryEnabled
        : input.global.memoryEnabled,
    userCustomPrompt:
      typeof workspace.userCustomPrompt === "string"
        ? workspace.userCustomPrompt
        : input.global.userCustomPrompt,
    createdAt: input.global.createdAt,
    updatedAt:
      typeof workspace.updatedAt === "string"
        ? workspace.updatedAt
        : input.global.updatedAt,
    ...(workspace.channels ? { channels: workspace.channels } : {}),
    ...(workspace.mcpServers ? { mcpServers: workspace.mcpServers } : {})
  };
}
