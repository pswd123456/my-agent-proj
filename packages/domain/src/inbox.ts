import { z } from "zod";

import {
  THINKING_EFFORT_OPTIONS,
  type ThinkingEffort
} from "./session-context.js";

export const INBOX_CHANNEL_OPTIONS = ["telegram"] as const;
export type InboxChannel = (typeof INBOX_CHANNEL_OPTIONS)[number];

export const INBOX_RESPONSE_OUTPUT_MODE_OPTIONS = ["final", "all"] as const;
export type InboxResponseOutputMode =
  (typeof INBOX_RESPONSE_OUTPUT_MODE_OPTIONS)[number];

export interface InboxBindingSettings {
  responseOutputMode: InboxResponseOutputMode;
}

export interface InboxBindingRecord {
  id: string;
  channel: InboxChannel;
  externalChatId: string;
  activeSessionId: string | null;
  userId: string;
  settings: InboxBindingSettings;
  lastUpdateId: number | null;
  createdAt: string;
  updatedAt: string;
}

export const inboxBindingSettingsSchema = z.object({
  responseOutputMode: z
    .enum(INBOX_RESPONSE_OUTPUT_MODE_OPTIONS)
    .default("final")
});

export type ParsedInboxCommand =
  | { kind: "message"; text: string }
  | { kind: "help" }
  | { kind: "new_session"; model?: string; thinkingEffort?: ThinkingEffort }
  | { kind: "switch_session"; sessionId: string }
  | { kind: "session_status" }
  | { kind: "list_models" }
  | { kind: "set_model"; model: string }
  | { kind: "list_thinking_efforts" }
  | { kind: "set_thinking_effort"; thinkingEffort: ThinkingEffort }
  | { kind: "set_output_mode"; outputMode: InboxResponseOutputMode }
  | { kind: "settings_status" }
  | { kind: "interrupt" }
  | { kind: "invalid"; message: string };

const thinkingEffortValues = new Set<string>(THINKING_EFFORT_OPTIONS);
const outputModeValues = new Set<string>(INBOX_RESPONSE_OUTPUT_MODE_OPTIONS);

function normalizeCommandName(value: string): string {
  const withoutMention = value.split("@")[0] ?? value;
  return withoutMention.trim().toLowerCase();
}

function parseThinkingEffort(value: string | undefined): ThinkingEffort | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || !thinkingEffortValues.has(candidate)) {
    return null;
  }

  return candidate as ThinkingEffort;
}

function parseOutputMode(
  value: string | undefined
): InboxResponseOutputMode | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || !outputModeValues.has(candidate)) {
    return null;
  }

  return candidate as InboxResponseOutputMode;
}

function formatAllowed(values: readonly string[]): string {
  return values.join(" | ");
}

export function normalizeInboxBindingSettings(
  value: unknown
): InboxBindingSettings {
  const parsed = inboxBindingSettingsSchema.safeParse(value);
  if (!parsed.success) {
    return { responseOutputMode: "final" };
  }

  return parsed.data;
}

export function createDefaultInboxBindingSettings(): InboxBindingSettings {
  return { responseOutputMode: "final" };
}

export function parseInboxCommand(text: string): ParsedInboxCommand {
  const normalized = text.trim();
  if (!normalized.startsWith("/")) {
    return { kind: "message", text: normalized };
  }

  const [rawCommand, ...args] = normalized.split(/\s+/);
  const command = normalizeCommandName(rawCommand ?? "");

  switch (command) {
    case "/help":
    case "/start":
      return { kind: "help" };
    case "/new": {
      const firstArg = args[0]?.trim();
      const secondArg = args[1]?.trim();
      const firstAsThinkingEffort = parseThinkingEffort(firstArg);
      const secondAsThinkingEffort = parseThinkingEffort(secondArg);
      if (secondArg && !secondAsThinkingEffort) {
        return {
          kind: "invalid",
          message: `Unsupported thinking effort "${secondArg}". Supported: ${formatAllowed(
            THINKING_EFFORT_OPTIONS
          )}.`
        };
      }
      if (args.length > 2) {
        return {
          kind: "invalid",
          message: "Usage: /new [model] [thinkingEffort]."
        };
      }

      if (firstAsThinkingEffort && !secondArg) {
        return {
          kind: "new_session",
          thinkingEffort: firstAsThinkingEffort
        };
      }

      return {
        kind: "new_session",
        ...(firstArg ? { model: firstArg } : {}),
        ...(secondAsThinkingEffort
          ? { thinkingEffort: secondAsThinkingEffort }
          : {})
      };
    }
    case "/switch": {
      const sessionId = args[0]?.trim();
      if (!sessionId || args.length !== 1) {
        return { kind: "invalid", message: "Usage: /switch <sessionId>." };
      }
      return { kind: "switch_session", sessionId };
    }
    case "/session":
      return { kind: "session_status" };
    case "/model": {
      const model = args.join(" ").trim();
      if (!model) {
        return { kind: "list_models" };
      }
      return { kind: "set_model", model };
    }
    case "/thinking": {
      const candidate = args[0]?.trim();
      if (!candidate) {
        return { kind: "list_thinking_efforts" };
      }
      const thinkingEffort = parseThinkingEffort(candidate);
      if (!thinkingEffort || args.length !== 1) {
        return {
          kind: "invalid",
          message: `Unsupported thinking effort "${candidate}". Supported: ${formatAllowed(
            THINKING_EFFORT_OPTIONS
          )}.`
        };
      }
      return { kind: "set_thinking_effort", thinkingEffort };
    }
    case "/output": {
      const outputMode = parseOutputMode(args[0]);
      if (!outputMode || args.length !== 1) {
        return {
          kind: "invalid",
          message: `Usage: /output <${formatAllowed(
            INBOX_RESPONSE_OUTPUT_MODE_OPTIONS
          )}>.`
        };
      }
      return { kind: "set_output_mode", outputMode };
    }
    case "/settings":
      return { kind: "settings_status" };
    case "/interrupt":
      return { kind: "interrupt" };
    default:
      return {
        kind: "invalid",
        message: `Unknown command "${rawCommand}". Send /help for available commands.`
      };
  }
}
