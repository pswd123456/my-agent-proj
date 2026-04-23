import type {
  PermissionRuleInput,
  PermissionRuleLists
} from "./permission-rules.js";
import {
  normalizePermissionRuleLists,
  PERMISSION_TOOL_OPTIONS
} from "./permission-rules.js";

export const DEFAULT_SESSION_SETTINGS_USER_ID = "cli-user";
export const DEFAULT_SESSION_WORKING_DIRECTORY = "agent-workspace";
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_SESSION_MAX_TURNS = 50;
export const SESSION_MAX_TURNS_LIMIT = 200;

export interface SessionSettingsRecord {
  userId: string;
  workingDirectory: string;
  yoloMode: boolean;
  contextWindow: number;
  maxTurns: number;
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionSettingsInput {
  workingDirectory?: string;
  yoloMode?: boolean;
  contextWindow?: number;
  maxTurns?: number;
  shellAllowPatterns?: string[];
  shellDenyPatterns?: string[];
  toolAllowList?: string[];
  toolAskList?: string[];
  toolDenyList?: string[];
}

export function resolveSessionSettingsDefaults(
  userId = DEFAULT_SESSION_SETTINGS_USER_ID
): SessionSettingsRecord {
  const timestamp = new Date().toISOString();
  return {
    userId,
    workingDirectory: DEFAULT_SESSION_WORKING_DIRECTORY,
    yoloMode: false,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTurns: DEFAULT_SESSION_MAX_TURNS,
    shellAllowPatterns: [],
    shellDenyPatterns: [],
    toolAllowList: [],
    toolAskList: [...PERMISSION_TOOL_OPTIONS],
    toolDenyList: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function normalizeSessionPermissionRules(
  input?: PermissionRuleInput | null
): PermissionRuleLists {
  return normalizePermissionRuleLists(input);
}

export function sanitizeContextWindow(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_WINDOW;
  }

  return Math.max(1_000, Math.floor(value));
}

export function sanitizeSessionMaxTurns(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SESSION_MAX_TURNS;
  }

  return Math.min(SESSION_MAX_TURNS_LIMIT, Math.max(1, Math.floor(value)));
}
