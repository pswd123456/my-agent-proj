import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type {
  InboxBindingRecord,
  InboxBindingSettings,
  InboxChannel
} from "@ai-app-template/domain";
import {
  createDefaultInboxBindingSettings,
  normalizeInboxBindingSettings
} from "@ai-app-template/domain";

import type { ProductDatabaseClient } from "./client.js";
import { inboxBindings } from "./schema.js";

export interface CreateInboxBindingInput {
  channel: InboxChannel;
  externalChatId: string;
}

export interface InboxBindingRepository {
  getByChannelExternalChat(
    channel: InboxChannel,
    externalChatId: string
  ): Promise<InboxBindingRecord | null>;
  getOrCreate(input: CreateInboxBindingInput): Promise<InboxBindingRecord>;
  updateActiveSession(
    bindingId: string,
    activeSessionId: string | null
  ): Promise<InboxBindingRecord | null>;
  updateSettings(
    bindingId: string,
    settings: InboxBindingSettings
  ): Promise<InboxBindingRecord | null>;
  markUpdateProcessed(
    bindingId: string,
    updateId: number
  ): Promise<InboxBindingRecord | null>;
}

type InboxBindingRow = typeof inboxBindings.$inferSelect;
type InboxBindingInsert = typeof inboxBindings.$inferInsert;

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

function mapInboxBindingRow(row: InboxBindingRow): InboxBindingRecord {
  return {
    id: row.id,
    channel: row.channel,
    externalChatId: row.externalChatId,
    activeSessionId: row.activeSessionId ?? null,
    settings: normalizeInboxBindingSettings(parseJsonValue(row.settings)),
    lastUpdateId: row.lastUpdateId ?? null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function buildInsert(input: CreateInboxBindingInput): InboxBindingInsert {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    channel: input.channel,
    externalChatId: input.externalChatId,
    activeSessionId: null,
    settings: createDefaultInboxBindingSettings(),
    lastUpdateId: null,
    createdAt: now,
    updatedAt: now
  };
}

export function createPostgresInboxBindingRepository(
  db: ProductDatabaseClient
): InboxBindingRepository {
  async function getByChannelExternalChat(
    channel: InboxChannel,
    externalChatId: string
  ): Promise<InboxBindingRecord | null> {
    const rows = await db
      .select()
      .from(inboxBindings)
      .where(
        and(
          eq(inboxBindings.channel, channel),
          eq(inboxBindings.externalChatId, externalChatId)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? mapInboxBindingRow(row) : null;
  }

  async function getById(
    bindingId: string
  ): Promise<InboxBindingRecord | null> {
    const rows = await db
      .select()
      .from(inboxBindings)
      .where(eq(inboxBindings.id, bindingId))
      .limit(1);
    const row = rows[0];
    return row ? mapInboxBindingRow(row) : null;
  }

  return {
    getByChannelExternalChat,
    async getOrCreate(input) {
      const existing = await getByChannelExternalChat(
        input.channel,
        input.externalChatId
      );
      if (existing) {
        return existing;
      }

      const rows = await db
        .insert(inboxBindings)
        .values(buildInsert(input))
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create inbox binding.");
      }
      return mapInboxBindingRow(row);
    },
    async updateActiveSession(bindingId, activeSessionId) {
      const rows = await db
        .update(inboxBindings)
        .set({
          activeSessionId,
          updatedAt: new Date().toISOString()
        })
        .where(eq(inboxBindings.id, bindingId))
        .returning();
      const row = rows[0];
      return row ? mapInboxBindingRow(row) : null;
    },
    async updateSettings(bindingId, settings) {
      const rows = await db
        .update(inboxBindings)
        .set({
          settings: normalizeInboxBindingSettings(settings),
          updatedAt: new Date().toISOString()
        })
        .where(eq(inboxBindings.id, bindingId))
        .returning();
      const row = rows[0];
      return row ? mapInboxBindingRow(row) : null;
    },
    async markUpdateProcessed(bindingId, updateId) {
      const existing = await getById(bindingId);
      if (!existing) {
        return null;
      }
      if (
        typeof existing.lastUpdateId === "number" &&
        updateId <= existing.lastUpdateId
      ) {
        return null;
      }

      const rows = await db
        .update(inboxBindings)
        .set({
          lastUpdateId: updateId,
          updatedAt: new Date().toISOString()
        })
        .where(eq(inboxBindings.id, bindingId))
        .returning();
      const row = rows[0];
      return row ? mapInboxBindingRow(row) : null;
    }
  };
}

export function createMemoryInboxBindingRepository(): InboxBindingRepository {
  const bindingsById = new Map<string, InboxBindingRecord>();

  function clone(record: InboxBindingRecord): InboxBindingRecord {
    return structuredClone(record);
  }

  function findByChannelExternalChat(
    channel: InboxChannel,
    externalChatId: string
  ): InboxBindingRecord | null {
    for (const binding of bindingsById.values()) {
      if (
        binding.channel === channel &&
        binding.externalChatId === externalChatId
      ) {
        return binding;
      }
    }
    return null;
  }

  return {
    async getByChannelExternalChat(channel, externalChatId) {
      const binding = findByChannelExternalChat(channel, externalChatId);
      return binding ? clone(binding) : null;
    },
    async getOrCreate(input) {
      const existing = findByChannelExternalChat(
        input.channel,
        input.externalChatId
      );
      if (existing) {
        return clone(existing);
      }

      const now = new Date().toISOString();
      const binding: InboxBindingRecord = {
        id: randomUUID(),
        channel: input.channel,
        externalChatId: input.externalChatId,
        activeSessionId: null,
        settings: createDefaultInboxBindingSettings(),
        lastUpdateId: null,
        createdAt: now,
        updatedAt: now
      };
      bindingsById.set(binding.id, binding);
      return clone(binding);
    },
    async updateActiveSession(bindingId, activeSessionId) {
      const binding = bindingsById.get(bindingId);
      if (!binding) {
        return null;
      }
      binding.activeSessionId = activeSessionId;
      binding.updatedAt = new Date().toISOString();
      return clone(binding);
    },
    async updateSettings(bindingId, settings) {
      const binding = bindingsById.get(bindingId);
      if (!binding) {
        return null;
      }
      binding.settings = normalizeInboxBindingSettings(settings);
      binding.updatedAt = new Date().toISOString();
      return clone(binding);
    },
    async markUpdateProcessed(bindingId, updateId) {
      const binding = bindingsById.get(bindingId);
      if (!binding) {
        return null;
      }
      if (
        typeof binding.lastUpdateId === "number" &&
        updateId <= binding.lastUpdateId
      ) {
        return null;
      }
      binding.lastUpdateId = updateId;
      binding.updatedAt = new Date().toISOString();
      return clone(binding);
    }
  };
}
