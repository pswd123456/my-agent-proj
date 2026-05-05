import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProductDatabaseClient } from "@ai-app-template/db";
import type {
  SessionSettingsInput,
  SessionSettingsRecord,
  SettingsConfigRecord
} from "@ai-app-template/domain";
import {
  SETTINGS_PERMISSION_TOOL_OPTIONS,
  mergeSettingsConfigRecords,
  normalizeCapabilityPacks,
  normalizeThinkingEffort,
  normalizeSettingsPermissionRules,
  normalizeUserContextHooks,
  normalizeWorkspaceSkillSettings,
  pickTomlSettingsFields,
  resolveSessionSettingsDefaults,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns,
  sanitizeUserCustomPrompt,
  toTomlSettingsFields
} from "@ai-app-template/domain";
import { parse, stringify } from "smol-toml";

import type { WorkspaceMcpServerConfig } from "../mcp/config-types.js";
import {
  loadWorkspaceHookConfig,
  mergeWorkspaceAndSettingsUserContextHooks
} from "../workspace-hooks/index.js";
import { getWorkspaceAgentConfigPath } from "../workspace-config/path.js";

const GLOBAL_AGENT_DIRECTORY = ".agents";
const GLOBAL_AGENT_CONFIG_FILE_NAME = "config.toml";

type TomlObject = Record<string, unknown>;
type LegacyAgentSettingsRow = {
  working_directory: string;
  model: string;
  thinking_effort: unknown;
  yolo_mode: boolean;
  context_window: number;
  max_turns: number;
  shell_allow_patterns: unknown;
  shell_deny_patterns: unknown;
  tool_allow_list: unknown;
  tool_ask_list: unknown;
  tool_deny_list: unknown;
  enabled_capability_packs: unknown;
  workspace_skill_settings: unknown;
  user_context_hooks: unknown;
  debug_conversation_view: boolean;
  user_custom_prompt: string;
};

function isRecord(value: unknown): value is TomlObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toGlobalAgentConfigPath(homeDir = os.homedir()): string {
  return path.join(
    homeDir,
    GLOBAL_AGENT_DIRECTORY,
    GLOBAL_AGENT_CONFIG_FILE_NAME
  );
}

function toWorkspaceAgentConfigPath(workingDirectory: string): string {
  return getWorkspaceAgentConfigPath(workingDirectory);
}

function defaultOptions(input?: {
  settingsPermissionToolOptions?: readonly string[];
}): {
  settingsPermissionToolOptions?: readonly string[];
} {
  const options: { settingsPermissionToolOptions?: readonly string[] } = {};
  if (input?.settingsPermissionToolOptions) {
    options.settingsPermissionToolOptions = input.settingsPermissionToolOptions;
  }
  return options;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toStringArray(value: unknown): string[] | undefined {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  return parsed.filter((item): item is string => typeof item === "string");
}

function normalizeTomlSettings(
  value: TomlObject,
  base: SessionSettingsRecord
): Partial<SettingsConfigRecord> {
  const settingsFields = pickTomlSettingsFields(value);
  const permissionRules = normalizeSettingsPermissionRules(
    {
      shellAllowPatterns: toStringArray(settingsFields.shellAllowPatterns),
      shellDenyPatterns: toStringArray(settingsFields.shellDenyPatterns),
      toolAllowList: toStringArray(settingsFields.toolAllowList),
      toolAskList: toStringArray(settingsFields.toolAskList),
      toolDenyList: toStringArray(settingsFields.toolDenyList)
    },
    SETTINGS_PERMISSION_TOOL_OPTIONS
  );

  const next: Partial<SettingsConfigRecord> = {
    ...(typeof settingsFields.workingDirectory === "string"
      ? {
          workingDirectory:
            settingsFields.workingDirectory.trim() || base.workingDirectory
        }
      : {}),
    ...(typeof settingsFields.model === "string"
      ? { model: settingsFields.model.trim() || base.model }
      : {}),
    ...(typeof settingsFields.thinkingEffort !== "undefined"
      ? {
          thinkingEffort: normalizeThinkingEffort(settingsFields.thinkingEffort)
        }
      : {}),
    ...(typeof settingsFields.yoloMode === "boolean"
      ? { yoloMode: settingsFields.yoloMode }
      : {}),
    ...(typeof settingsFields.contextWindow === "number"
      ? { contextWindow: sanitizeContextWindow(settingsFields.contextWindow) }
      : {}),
    ...(typeof settingsFields.maxTurns === "number"
      ? { maxTurns: sanitizeSessionMaxTurns(settingsFields.maxTurns) }
      : {}),
    ...(typeof settingsFields.debugConversationView === "boolean"
      ? { debugConversationView: settingsFields.debugConversationView }
      : {}),
    ...(typeof settingsFields.userCustomPrompt === "string"
      ? {
          userCustomPrompt: sanitizeUserCustomPrompt(
            settingsFields.userCustomPrompt
          )
        }
      : {}),
    shellAllowPatterns: permissionRules.shellAllowPatterns,
    shellDenyPatterns: permissionRules.shellDenyPatterns,
    toolAllowList: permissionRules.toolAllowList,
    toolAskList: permissionRules.toolAskList,
    toolDenyList: permissionRules.toolDenyList,
    ...(typeof settingsFields.enabledCapabilityPacks !== "undefined"
      ? {
          enabledCapabilityPacks: normalizeCapabilityPacks(
            toStringArray(settingsFields.enabledCapabilityPacks)
          )
        }
      : {}),
    ...(typeof settingsFields.workspaceSkillSettings !== "undefined"
      ? {
          workspaceSkillSettings: normalizeWorkspaceSkillSettings(
            parseJsonValue(settingsFields.workspaceSkillSettings)
          )
        }
      : {}),
    ...(typeof settingsFields.userContextHooks !== "undefined"
      ? {
          userContextHooks: normalizeUserContextHooks(
            parseJsonValue(settingsFields.userContextHooks)
          )
        }
      : {})
  };

  if (isRecord(value.channels)) {
    const telegram = isRecord(value.channels.telegram)
      ? value.channels.telegram
      : undefined;
    if (telegram) {
      next.channels = {
        telegram: {
          ...(typeof telegram.enabled === "boolean"
            ? { enabled: telegram.enabled }
            : {}),
          ...(telegram.mode === "polling" || telegram.mode === "webhook"
            ? { mode: telegram.mode }
            : {}),
          ...(typeof telegram.bot_token === "string"
            ? { botToken: telegram.bot_token.trim() }
            : {}),
          ...(typeof telegram.webhook_secret === "string"
            ? { webhookSecret: telegram.webhook_secret.trim() }
            : {}),
          ...(typeof telegram.webhook_url === "string"
            ? { webhookUrl: telegram.webhook_url.trim() }
            : {})
        }
      };
    }
  }

  if (isRecord(value.mcp_servers)) {
    next.mcpServers = value.mcp_servers;
  }

  return next;
}

function toTomlConfig(
  settings: SessionSettingsRecord,
  existingRoot: TomlObject = {}
): string {
  const next: TomlObject = {
    ...existingRoot,
    ...toTomlSettingsFields(settings)
  };
  return `${stringify(next)}\n`;
}

async function readTomlRoot(configPath: string): Promise<TomlObject> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

async function readSeedSettingsFromDatabase(input: {
  db: ProductDatabaseClient;
  seedUserId: string;
  settingsPermissionToolOptions?: readonly string[];
}): Promise<SessionSettingsRecord> {
  const rows = await input.db.$client<LegacyAgentSettingsRow[]>`
    select
      working_directory,
      model,
      thinking_effort,
      yolo_mode,
      context_window,
      max_turns,
      shell_allow_patterns,
      shell_deny_patterns,
      tool_allow_list,
      tool_ask_list,
      tool_deny_list,
      enabled_capability_packs,
      workspace_skill_settings,
      user_context_hooks,
      debug_conversation_view,
      user_custom_prompt
    from agent_settings
    where user_id = ${input.seedUserId}
    limit 1
  `.catch((error: unknown) => {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      return [];
    }
    throw error;
  });
  const row = rows[0];
  if (!row) {
    return resolveSessionSettingsDefaults(defaultOptions(input));
  }

  const base = resolveSessionSettingsDefaults(defaultOptions(input));
  const normalized = normalizeTomlSettings(
    {
      working_directory: row.working_directory,
      model: row.model,
      thinking_effort: row.thinking_effort,
      yolo_mode: row.yolo_mode,
      context_window: row.context_window,
      max_turns: row.max_turns,
      shell_allow_patterns: row.shell_allow_patterns,
      shell_deny_patterns: row.shell_deny_patterns,
      tool_allow_list: row.tool_allow_list,
      tool_ask_list: row.tool_ask_list,
      tool_deny_list: row.tool_deny_list,
      enabled_capability_packs: row.enabled_capability_packs,
      workspace_skill_settings: row.workspace_skill_settings,
      user_context_hooks: row.user_context_hooks,
      debug_conversation_view: row.debug_conversation_view,
      user_custom_prompt: row.user_custom_prompt
    },
    base
  );

  return mergeSettingsConfigRecords({ global: base, workspace: normalized });
}

export interface SettingsConfigStore {
  getGlobalPath(): string;
  getWorkspacePath(workingDirectory: string): string;
  getGlobalSettings(): Promise<SessionSettingsRecord>;
  getEffectiveSettings(workingDirectory: string): Promise<SettingsConfigRecord>;
  updateGlobalSettings(
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord>;
  updateWorkspaceChannels(
    workingDirectory: string,
    telegram: {
      enabled: boolean;
      mode: "polling" | "webhook";
      botToken: string;
      webhookSecret: string;
      webhookUrl: string;
    }
  ): Promise<void>;
  updateWorkspaceMcpServers(
    workingDirectory: string,
    servers: readonly WorkspaceMcpServerConfig[]
  ): Promise<void>;
}

export function createSettingsConfigStore(input?: {
  db?: ProductDatabaseClient;
  seedUserId?: string;
  homeDir?: string;
  settingsPermissionToolOptions?: readonly string[];
}): SettingsConfigStore {
  const globalConfigPath = toGlobalAgentConfigPath(input?.homeDir);

  async function ensureGlobalConfig(): Promise<SessionSettingsRecord> {
    try {
      await fs.access(globalConfigPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const seed = input?.db
        ? await readSeedSettingsFromDatabase({
            db: input.db,
            seedUserId: input.seedUserId ?? "cli-user",
            ...defaultOptions(input)
          })
        : resolveSessionSettingsDefaults(defaultOptions(input));
      await fs.mkdir(path.dirname(globalConfigPath), { recursive: true });
      await fs.writeFile(globalConfigPath, toTomlConfig(seed), "utf8");
      return seed;
    }

    const base = resolveSessionSettingsDefaults(defaultOptions(input));
    const root = await readTomlRoot(globalConfigPath);
    return mergeSettingsConfigRecords({
      global: base,
      workspace: normalizeTomlSettings(root, base)
    });
  }

  return {
    getGlobalPath() {
      return globalConfigPath;
    },
    getWorkspacePath(workingDirectory: string) {
      return toWorkspaceAgentConfigPath(workingDirectory);
    },
    async getGlobalSettings() {
      return ensureGlobalConfig();
    },
    async getEffectiveSettings(workingDirectory: string) {
      const global = await ensureGlobalConfig();
      const workspaceRoot = await readTomlRoot(
        toWorkspaceAgentConfigPath(workingDirectory)
      );
      const workspaceHookConfig =
        await loadWorkspaceHookConfig(workingDirectory);
      const merged = mergeSettingsConfigRecords({
        global,
        workspace: normalizeTomlSettings(workspaceRoot, global)
      });
      if (workspaceHookConfig.hooks.length === 0) {
        return merged;
      }
      return {
        ...merged,
        userContextHooks: mergeWorkspaceAndSettingsUserContextHooks({
          workspaceHooks: workspaceHookConfig.hooks,
          settingsHooks: merged.userContextHooks
        })
      };
    },
    async updateGlobalSettings(patch) {
      const current = await ensureGlobalConfig();
      const permissionRules = normalizeSettingsPermissionRules(
        {
          shellAllowPatterns:
            patch.shellAllowPatterns ?? current.shellAllowPatterns,
          shellDenyPatterns:
            patch.shellDenyPatterns ?? current.shellDenyPatterns,
          toolAllowList: patch.toolAllowList ?? current.toolAllowList,
          toolAskList: patch.toolAskList ?? current.toolAskList,
          toolDenyList: patch.toolDenyList ?? current.toolDenyList
        },
        input?.settingsPermissionToolOptions ?? SETTINGS_PERMISSION_TOOL_OPTIONS
      );
      const next: SessionSettingsRecord = {
        ...current,
        ...(typeof patch.workingDirectory === "string"
          ? {
              workingDirectory:
                patch.workingDirectory.trim() || current.workingDirectory
            }
          : {}),
        ...(typeof patch.model === "string"
          ? { model: patch.model.trim() || current.model }
          : {}),
        ...(patch.thinkingEffort
          ? { thinkingEffort: normalizeThinkingEffort(patch.thinkingEffort) }
          : {}),
        ...(typeof patch.yoloMode === "boolean"
          ? { yoloMode: patch.yoloMode }
          : {}),
        ...(typeof patch.contextWindow === "number"
          ? { contextWindow: sanitizeContextWindow(patch.contextWindow) }
          : {}),
        ...(typeof patch.maxTurns === "number"
          ? { maxTurns: sanitizeSessionMaxTurns(patch.maxTurns) }
          : {}),
        shellAllowPatterns: permissionRules.shellAllowPatterns,
        shellDenyPatterns: permissionRules.shellDenyPatterns,
        toolAllowList: permissionRules.toolAllowList,
        toolAskList: permissionRules.toolAskList,
        toolDenyList: permissionRules.toolDenyList,
        enabledCapabilityPacks: Array.isArray(patch.enabledCapabilityPacks)
          ? normalizeCapabilityPacks(patch.enabledCapabilityPacks)
          : current.enabledCapabilityPacks,
        workspaceSkillSettings:
          typeof patch.workspaceSkillSettings === "undefined"
            ? current.workspaceSkillSettings
            : normalizeWorkspaceSkillSettings(patch.workspaceSkillSettings),
        userContextHooks:
          typeof patch.userContextHooks === "undefined"
            ? current.userContextHooks
            : normalizeUserContextHooks(patch.userContextHooks),
        ...(typeof patch.debugConversationView === "boolean"
          ? { debugConversationView: patch.debugConversationView }
          : {}),
        ...(typeof patch.userCustomPrompt === "string"
          ? {
              userCustomPrompt: sanitizeUserCustomPrompt(patch.userCustomPrompt)
            }
          : {}),
        updatedAt: new Date().toISOString()
      };
      const existingRoot = await readTomlRoot(globalConfigPath);
      await fs.mkdir(path.dirname(globalConfigPath), { recursive: true });
      await fs.writeFile(
        globalConfigPath,
        toTomlConfig(next, existingRoot),
        "utf8"
      );
      return next;
    },
    async updateWorkspaceChannels(workingDirectory, telegram) {
      const configPath = toWorkspaceAgentConfigPath(workingDirectory);
      const root = await readTomlRoot(configPath);
      const channels = isRecord(root.channels) ? root.channels : {};
      const next = {
        ...root,
        channels: {
          ...channels,
          telegram: {
            enabled: telegram.enabled,
            mode: telegram.mode,
            bot_token: telegram.botToken,
            ...(telegram.webhookSecret
              ? { webhook_secret: telegram.webhookSecret }
              : {}),
            ...(telegram.webhookUrl ? { webhook_url: telegram.webhookUrl } : {})
          }
        }
      };
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${stringify(next)}\n`, "utf8");
    },
    async updateWorkspaceMcpServers(workingDirectory, servers) {
      const configPath = toWorkspaceAgentConfigPath(workingDirectory);
      const root = await readTomlRoot(configPath);
      const mcpServers: Record<string, unknown> = {};
      for (const server of servers) {
        if (server.transport === "stdio") {
          mcpServers[server.name] = {
            ...(server.enabled === false ? { enabled: false } : {}),
            command: server.command,
            ...(server.args.length > 0 ? { args: server.args } : {}),
            ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
            ...(server.disabledTools.length > 0
              ? { disabled_tools: server.disabledTools }
              : {})
          };
          continue;
        }
        mcpServers[server.name] = {
          ...(server.enabled === false ? { enabled: false } : {}),
          url: server.url,
          ...(Object.keys(server.headers).length > 0
            ? { headers: server.headers }
            : {}),
          ...(server.disabledTools.length > 0
            ? { disabled_tools: server.disabledTools }
            : {})
        };
      }
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        `${stringify({ ...root, mcp_servers: mcpServers })}\n`,
        "utf8"
      );
    }
  };
}
