import { eq } from "drizzle-orm";

import type {
  SessionSettingsInput,
  SessionSettingsRecord
} from "@ai-app-template/domain";
import {
  DEFAULT_SESSION_MODEL,
  SETTINGS_PERMISSION_TOOL_OPTIONS,
  normalizeCapabilityPacks,
  normalizeThinkingEffort,
  normalizeSettingsPermissionRules,
  normalizeUserContextHooks,
  resolveSessionSettingsDefaults,
  sanitizeUserCustomPrompt,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns
} from "@ai-app-template/domain";

import { agentSettings } from "./schema.js";
import type { ProductDatabaseClient } from "./client.js";

export interface SettingsRepository {
  getOrCreate(userId: string): Promise<SessionSettingsRecord>;
  update(
    userId: string,
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord>;
}

type SettingsRow = typeof agentSettings.$inferSelect;

function toIsoString(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const tzMatch = normalized.match(/([+-]\d{2})(\d{2})?$/);
  const hasExplicitTimeZone =
    normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized) || tzMatch;
  const parsedValue = tzMatch
    ? normalized.replace(
        /([+-]\d{2})(\d{2})?$/,
        (_, hours: string, minutes?: string) => `${hours}:${minutes ?? "00"}`
      )
    : normalized;

  return new Date(
    hasExplicitTimeZone ? parsedValue : `${normalized}Z`
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

export function mapSettingsRow(
  row: SettingsRow,
  settingsPermissionToolOptions: readonly string[] = SETTINGS_PERMISSION_TOOL_OPTIONS
): SessionSettingsRecord {
  const permissionRules = normalizeSettingsPermissionRules(
    {
      shellAllowPatterns: toStringArray(row.shellAllowPatterns),
      shellDenyPatterns: toStringArray(row.shellDenyPatterns),
      toolAllowList: toStringArray(row.toolAllowList),
      toolAskList: toStringArray(row.toolAskList),
      toolDenyList: toStringArray(row.toolDenyList)
    },
    settingsPermissionToolOptions
  );

  return {
    userId: row.userId,
    workingDirectory: row.workingDirectory,
    model:
      typeof row.model === "string" && row.model.trim().length > 0
        ? row.model
        : DEFAULT_SESSION_MODEL,
    thinkingEffort: normalizeThinkingEffort(row.thinkingEffort),
    yoloMode: row.yoloMode,
    contextWindow: sanitizeContextWindow(row.contextWindow),
    maxTurns: sanitizeSessionMaxTurns(row.maxTurns),
    shellAllowPatterns: permissionRules.shellAllowPatterns,
    shellDenyPatterns: permissionRules.shellDenyPatterns,
    toolAllowList: permissionRules.toolAllowList,
    toolAskList: permissionRules.toolAskList,
    toolDenyList: permissionRules.toolDenyList,
    enabledCapabilityPacks: normalizeCapabilityPacks(
      toStringArray(row.enabledCapabilityPacks)
    ),
    userContextHooks: normalizeUserContextHooks(
      parseJsonValue(
        row.userContextHooks ??
          (row as { user_context_hooks?: unknown }).user_context_hooks
      )
    ),
    debugConversationView:
      row.debugConversationView ??
      (row as { debug_conversation_view?: boolean }).debug_conversation_view ??
      false,
    userCustomPrompt: sanitizeUserCustomPrompt(
      row.userCustomPrompt ??
        (row as { user_custom_prompt?: string }).user_custom_prompt
    ),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function buildPatchedSettings(
  current: SessionSettingsRecord,
  patch: SessionSettingsInput,
  settingsPermissionToolOptions: readonly string[] = SETTINGS_PERMISSION_TOOL_OPTIONS
): SessionSettingsRecord {
  const permissionRules = normalizeSettingsPermissionRules(
    {
      shellAllowPatterns:
        patch.shellAllowPatterns ?? current.shellAllowPatterns,
      shellDenyPatterns: patch.shellDenyPatterns ?? current.shellDenyPatterns,
      toolAllowList: patch.toolAllowList ?? current.toolAllowList,
      toolAskList: patch.toolAskList ?? current.toolAskList,
      toolDenyList: patch.toolDenyList ?? current.toolDenyList
    },
    settingsPermissionToolOptions
  );

  return {
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
    userContextHooks:
      typeof patch.userContextHooks === "undefined"
        ? current.userContextHooks
        : normalizeUserContextHooks(patch.userContextHooks),
    ...(typeof patch.debugConversationView === "boolean"
      ? { debugConversationView: patch.debugConversationView }
      : {}),
    ...(typeof patch.userCustomPrompt === "string"
      ? { userCustomPrompt: sanitizeUserCustomPrompt(patch.userCustomPrompt) }
      : {}),
    updatedAt: new Date().toISOString()
  };
}

export class PostgresSettingsRepository implements SettingsRepository {
  constructor(
    private readonly db: ProductDatabaseClient,
    private readonly settingsPermissionToolOptions: readonly string[] = SETTINGS_PERMISSION_TOOL_OPTIONS
  ) {}

  async getOrCreate(userId: string): Promise<SessionSettingsRecord> {
    const existing = await this.getByUserId(userId);
    if (existing) {
      return existing;
    }

    const defaults = resolveSessionSettingsDefaults(userId, {
      settingsPermissionToolOptions: this.settingsPermissionToolOptions
    });
    const rows = await this.db
      .insert(agentSettings)
      .values({
        userId: defaults.userId,
        workingDirectory: defaults.workingDirectory,
        model: defaults.model,
        thinkingEffort: defaults.thinkingEffort,
        yoloMode: defaults.yoloMode,
        contextWindow: defaults.contextWindow,
        maxTurns: defaults.maxTurns,
        shellAllowPatterns: defaults.shellAllowPatterns,
        shellDenyPatterns: defaults.shellDenyPatterns,
        toolAllowList: defaults.toolAllowList,
        toolAskList: defaults.toolAskList,
        toolDenyList: defaults.toolDenyList,
        enabledCapabilityPacks: defaults.enabledCapabilityPacks,
        userContextHooks: defaults.userContextHooks,
        debugConversationView: defaults.debugConversationView,
        userCustomPrompt: defaults.userCustomPrompt,
        createdAt: defaults.createdAt,
        updatedAt: defaults.updatedAt
      })
      .onConflictDoUpdate({
        target: agentSettings.userId,
        set: {
          updatedAt: new Date().toISOString()
        }
      })
      .returning();

    return mapSettingsRow(rows[0]!, this.settingsPermissionToolOptions);
  }

  async update(
    userId: string,
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord> {
    const current = await this.getOrCreate(userId);
    const next = buildPatchedSettings(
      current,
      patch,
      this.settingsPermissionToolOptions
    );

    const rows = await this.db
      .insert(agentSettings)
      .values({
        userId: next.userId,
        workingDirectory: next.workingDirectory,
        model: next.model,
        thinkingEffort: next.thinkingEffort,
        yoloMode: next.yoloMode,
        contextWindow: next.contextWindow,
        maxTurns: next.maxTurns,
        shellAllowPatterns: next.shellAllowPatterns,
        shellDenyPatterns: next.shellDenyPatterns,
        toolAllowList: next.toolAllowList,
        toolAskList: next.toolAskList,
        toolDenyList: next.toolDenyList,
        enabledCapabilityPacks: next.enabledCapabilityPacks,
        userContextHooks: next.userContextHooks,
        debugConversationView: next.debugConversationView,
        userCustomPrompt: next.userCustomPrompt,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt
      })
      .onConflictDoUpdate({
        target: agentSettings.userId,
        set: {
          workingDirectory: next.workingDirectory,
          model: next.model,
          thinkingEffort: next.thinkingEffort,
          yoloMode: next.yoloMode,
          contextWindow: next.contextWindow,
          maxTurns: next.maxTurns,
          shellAllowPatterns: next.shellAllowPatterns,
          shellDenyPatterns: next.shellDenyPatterns,
          toolAllowList: next.toolAllowList,
          toolAskList: next.toolAskList,
          toolDenyList: next.toolDenyList,
          enabledCapabilityPacks: next.enabledCapabilityPacks,
          userContextHooks: next.userContextHooks,
          debugConversationView: next.debugConversationView,
          userCustomPrompt: next.userCustomPrompt,
          updatedAt: next.updatedAt
        }
      })
      .returning();

    return mapSettingsRow(rows[0]!, this.settingsPermissionToolOptions);
  }

  private async getByUserId(
    userId: string
  ): Promise<SessionSettingsRecord | null> {
    const rows = await this.db
      .select()
      .from(agentSettings)
      .where(eq(agentSettings.userId, userId))
      .limit(1);

    return rows[0]
      ? mapSettingsRow(rows[0], this.settingsPermissionToolOptions)
      : null;
  }
}

export class MemorySettingsRepository implements SettingsRepository {
  private readonly settings = new Map<string, SessionSettingsRecord>();

  constructor(
    private readonly settingsPermissionToolOptions: readonly string[] = SETTINGS_PERMISSION_TOOL_OPTIONS
  ) {}

  async getOrCreate(userId: string): Promise<SessionSettingsRecord> {
    const current = this.settings.get(userId);
    if (current) {
      return structuredClone(current) as SessionSettingsRecord;
    }

    const defaults = resolveSessionSettingsDefaults(userId, {
      settingsPermissionToolOptions: this.settingsPermissionToolOptions
    });
    this.settings.set(userId, defaults);
    return structuredClone(defaults) as SessionSettingsRecord;
  }

  async update(
    userId: string,
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord> {
    const current = await this.getOrCreate(userId);
    const next = buildPatchedSettings(
      current,
      patch,
      this.settingsPermissionToolOptions
    );
    this.settings.set(userId, next);
    return structuredClone(next) as SessionSettingsRecord;
  }
}

export function createPostgresSettingsRepository(
  db: ProductDatabaseClient,
  options?: {
    settingsPermissionToolOptions?: readonly string[];
  }
): PostgresSettingsRepository {
  return new PostgresSettingsRepository(
    db,
    options?.settingsPermissionToolOptions
  );
}

export function createMemorySettingsRepository(options?: {
  settingsPermissionToolOptions?: readonly string[];
}): MemorySettingsRepository {
  return new MemorySettingsRepository(options?.settingsPermissionToolOptions);
}
