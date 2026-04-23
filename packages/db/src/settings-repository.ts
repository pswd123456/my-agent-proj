import type {
  SessionSettingsInput,
  SessionSettingsRecord
} from "@ai-app-template/domain";
import {
  resolveSessionSettingsDefaults,
  normalizePermissionRuleLists,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns
} from "@ai-app-template/domain";

import type { ProductDatabaseClient } from "./client.js";

export interface SettingsRepository {
  getOrCreate(userId: string): Promise<SessionSettingsRecord>;
  update(
    userId: string,
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord>;
}

interface SettingsRow {
  user_id: string;
  working_directory: string;
  yolo_mode: boolean;
  context_window: number;
  max_turns: number;
  shell_allow_patterns: unknown;
  shell_deny_patterns: unknown;
  tool_allow_list: unknown;
  tool_ask_list: unknown;
  tool_deny_list: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasExplicitTimeZone =
    normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized);

  return new Date(
    hasExplicitTimeZone ? normalized : `${normalized}Z`
  ).toISOString();
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

function toStringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === "string");
}

function mapSettingsRow(row: SettingsRow): SessionSettingsRecord {
  const permissionRules = normalizePermissionRuleLists({
    shellAllowPatterns: toStringArray(row.shell_allow_patterns),
    shellDenyPatterns: toStringArray(row.shell_deny_patterns),
    toolAllowList: toStringArray(row.tool_allow_list),
    toolAskList: toStringArray(row.tool_ask_list),
    toolDenyList: toStringArray(row.tool_deny_list)
  });
  return {
    userId: row.user_id,
    workingDirectory: row.working_directory,
    yoloMode: row.yolo_mode,
    contextWindow: sanitizeContextWindow(row.context_window),
    maxTurns: sanitizeSessionMaxTurns(row.max_turns),
    shellAllowPatterns: permissionRules.shellAllowPatterns,
    shellDenyPatterns: permissionRules.shellDenyPatterns,
    toolAllowList: permissionRules.toolAllowList,
    toolAskList: permissionRules.toolAskList,
    toolDenyList: permissionRules.toolDenyList,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function buildPatchedSettings(
  current: SessionSettingsRecord,
  patch: SessionSettingsInput
): SessionSettingsRecord {
  const permissionRules = normalizePermissionRuleLists({
    shellAllowPatterns:
      patch.shellAllowPatterns ?? current.shellAllowPatterns,
    shellDenyPatterns: patch.shellDenyPatterns ?? current.shellDenyPatterns,
    toolAllowList: patch.toolAllowList ?? current.toolAllowList,
    toolAskList: patch.toolAskList ?? current.toolAskList,
    toolDenyList: patch.toolDenyList ?? current.toolDenyList
  });

  return {
    ...current,
    ...(typeof patch.workingDirectory === "string"
      ? {
          workingDirectory:
            patch.workingDirectory.trim() || current.workingDirectory
        }
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
    updatedAt: new Date().toISOString()
  };
}

export class PostgresSettingsRepository implements SettingsRepository {
  constructor(private readonly sql: ProductDatabaseClient) {}

  async getOrCreate(userId: string): Promise<SessionSettingsRecord> {
    const existing = await this.getByUserId(userId);
    if (existing) {
      return existing;
    }

    const defaults = resolveSessionSettingsDefaults(userId);
    const rows = await this.sql<SettingsRow[]>`
      insert into agent_settings (
        user_id,
        working_directory,
        yolo_mode,
        context_window,
        max_turns,
        shell_allow_patterns,
        shell_deny_patterns,
        tool_allow_list,
        tool_ask_list,
        tool_deny_list,
        created_at,
        updated_at
      )
      values (
        ${defaults.userId},
        ${defaults.workingDirectory},
        ${defaults.yoloMode},
        ${defaults.contextWindow},
        ${defaults.maxTurns},
        ${JSON.stringify(defaults.shellAllowPatterns)}::jsonb,
        ${JSON.stringify(defaults.shellDenyPatterns)}::jsonb,
        ${JSON.stringify(defaults.toolAllowList)}::jsonb,
        ${JSON.stringify(defaults.toolAskList)}::jsonb,
        ${JSON.stringify(defaults.toolDenyList)}::jsonb,
        ${defaults.createdAt},
        ${defaults.updatedAt}
      )
      on conflict (user_id) do update set
        updated_at = agent_settings.updated_at
      returning *
    `;

    return mapSettingsRow(rows[0]!);
  }

  async update(
    userId: string,
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord> {
    const current = await this.getOrCreate(userId);
    const next = buildPatchedSettings(current, patch);

    const rows = await this.sql<SettingsRow[]>`
      insert into agent_settings (
        user_id,
        working_directory,
        yolo_mode,
        context_window,
        max_turns,
        shell_allow_patterns,
        shell_deny_patterns,
        tool_allow_list,
        tool_ask_list,
        tool_deny_list,
        created_at,
        updated_at
      )
      values (
        ${next.userId},
        ${next.workingDirectory},
        ${next.yoloMode},
        ${next.contextWindow},
        ${next.maxTurns},
        ${JSON.stringify(next.shellAllowPatterns)}::jsonb,
        ${JSON.stringify(next.shellDenyPatterns)}::jsonb,
        ${JSON.stringify(next.toolAllowList)}::jsonb,
        ${JSON.stringify(next.toolAskList)}::jsonb,
        ${JSON.stringify(next.toolDenyList)}::jsonb,
        ${next.createdAt},
        ${next.updatedAt}
      )
      on conflict (user_id) do update set
        working_directory = excluded.working_directory,
        yolo_mode = excluded.yolo_mode,
        context_window = excluded.context_window,
        max_turns = excluded.max_turns,
        shell_allow_patterns = excluded.shell_allow_patterns,
        shell_deny_patterns = excluded.shell_deny_patterns,
        tool_allow_list = excluded.tool_allow_list,
        tool_ask_list = excluded.tool_ask_list,
        tool_deny_list = excluded.tool_deny_list,
        updated_at = excluded.updated_at
      returning *
    `;

    return mapSettingsRow(rows[0]!);
  }

  private async getByUserId(
    userId: string
  ): Promise<SessionSettingsRecord | null> {
    const rows = await this.sql<SettingsRow[]>`
      select *
      from agent_settings
      where user_id = ${userId}
      limit 1
    `;
    return rows[0] ? mapSettingsRow(rows[0]) : null;
  }
}

export class MemorySettingsRepository implements SettingsRepository {
  private readonly settings = new Map<string, SessionSettingsRecord>();

  async getOrCreate(userId: string): Promise<SessionSettingsRecord> {
    const current = this.settings.get(userId);
    if (current) {
      return structuredClone(current) as SessionSettingsRecord;
    }

    const defaults = resolveSessionSettingsDefaults(userId);
    this.settings.set(userId, defaults);
    return structuredClone(defaults) as SessionSettingsRecord;
  }

  async update(
    userId: string,
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord> {
    const current = await this.getOrCreate(userId);
    const next = buildPatchedSettings(current, patch);
    this.settings.set(userId, next);
    return structuredClone(next) as SessionSettingsRecord;
  }
}

export function createPostgresSettingsRepository(
  sql: ProductDatabaseClient
): PostgresSettingsRepository {
  return new PostgresSettingsRepository(sql);
}

export function createMemorySettingsRepository(): MemorySettingsRepository {
  return new MemorySettingsRepository();
}
