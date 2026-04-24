import { eq } from "drizzle-orm";

import type {
  SessionSettingsInput,
  SessionSettingsRecord
} from "@ai-app-template/domain";
import {
  normalizePermissionRuleLists,
  resolveSessionSettingsDefaults,
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
    ? normalized.replace(/([+-]\d{2})(\d{2})?$/, (_, hours: string, minutes?: string) =>
        `${hours}:${minutes ?? "00"}`
      )
    : normalized;

  return new Date(hasExplicitTimeZone ? parsedValue : `${normalized}Z`).toISOString();
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

export function mapSettingsRow(row: SettingsRow): SessionSettingsRecord {
  const permissionRules = normalizePermissionRuleLists({
    shellAllowPatterns: toStringArray(row.shellAllowPatterns),
    shellDenyPatterns: toStringArray(row.shellDenyPatterns),
    toolAllowList: toStringArray(row.toolAllowList),
    toolAskList: toStringArray(row.toolAskList),
    toolDenyList: toStringArray(row.toolDenyList)
  });

  return {
    userId: row.userId,
    workingDirectory: row.workingDirectory,
    yoloMode: row.yoloMode,
    contextWindow: sanitizeContextWindow(row.contextWindow),
    maxTurns: sanitizeSessionMaxTurns(row.maxTurns),
    shellAllowPatterns: permissionRules.shellAllowPatterns,
    shellDenyPatterns: permissionRules.shellDenyPatterns,
    toolAllowList: permissionRules.toolAllowList,
    toolAskList: permissionRules.toolAskList,
    toolDenyList: permissionRules.toolDenyList,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
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
  constructor(private readonly db: ProductDatabaseClient) {}

  async getOrCreate(userId: string): Promise<SessionSettingsRecord> {
    const existing = await this.getByUserId(userId);
    if (existing) {
      return existing;
    }

    const defaults = resolveSessionSettingsDefaults(userId);
    const rows = await this.db
      .insert(agentSettings)
      .values({
        userId: defaults.userId,
        workingDirectory: defaults.workingDirectory,
        yoloMode: defaults.yoloMode,
        contextWindow: defaults.contextWindow,
        maxTurns: defaults.maxTurns,
        shellAllowPatterns: defaults.shellAllowPatterns,
        shellDenyPatterns: defaults.shellDenyPatterns,
        toolAllowList: defaults.toolAllowList,
        toolAskList: defaults.toolAskList,
        toolDenyList: defaults.toolDenyList,
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

    return mapSettingsRow(rows[0]!);
  }

  async update(
    userId: string,
    patch: SessionSettingsInput
  ): Promise<SessionSettingsRecord> {
    const current = await this.getOrCreate(userId);
    const next = buildPatchedSettings(current, patch);

    const rows = await this.db
      .insert(agentSettings)
      .values({
        userId: next.userId,
        workingDirectory: next.workingDirectory,
        yoloMode: next.yoloMode,
        contextWindow: next.contextWindow,
        maxTurns: next.maxTurns,
        shellAllowPatterns: next.shellAllowPatterns,
        shellDenyPatterns: next.shellDenyPatterns,
        toolAllowList: next.toolAllowList,
        toolAskList: next.toolAskList,
        toolDenyList: next.toolDenyList,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt
      })
      .onConflictDoUpdate({
        target: agentSettings.userId,
        set: {
          workingDirectory: next.workingDirectory,
          yoloMode: next.yoloMode,
          contextWindow: next.contextWindow,
          maxTurns: next.maxTurns,
          shellAllowPatterns: next.shellAllowPatterns,
          shellDenyPatterns: next.shellDenyPatterns,
          toolAllowList: next.toolAllowList,
          toolAskList: next.toolAskList,
          toolDenyList: next.toolDenyList,
          updatedAt: next.updatedAt
        }
      })
      .returning();

    return mapSettingsRow(rows[0]!);
  }

  private async getByUserId(
    userId: string
  ): Promise<SessionSettingsRecord | null> {
    const rows = await this.db
      .select()
      .from(agentSettings)
      .where(eq(agentSettings.userId, userId))
      .limit(1);

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
  db: ProductDatabaseClient
): PostgresSettingsRepository {
  return new PostgresSettingsRepository(db);
}

export function createMemorySettingsRepository(): MemorySettingsRepository {
  return new MemorySettingsRepository();
}
