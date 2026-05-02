import type {
  PermissionRuleInput,
  PermissionRuleLists
} from "./permission-rules.js";
import {
  normalizePermissionRuleLists,
  normalizeSettingsPermissionRuleLists,
  SETTINGS_PERMISSION_TOOL_OPTIONS
} from "./permission-rules.js";
import {
  DEFAULT_THINKING_EFFORT,
  normalizeThinkingEffort,
  type ThinkingEffort
} from "./session-context.js";
import type { UserContextHookRecord } from "./user-context-hooks.js";
import type { WorkspaceSkillSettingRecord } from "./workspace-skills.js";

export const DEFAULT_SESSION_SETTINGS_USER_ID = "cli-user";
export const DEFAULT_SESSION_WORKING_DIRECTORY = "agent-workspace";
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_SESSION_MAX_TURNS = 100;
export const SESSION_MAX_TURNS_LIMIT = 200;
export const DEFAULT_SESSION_MODEL = "MiniMax-M2.7";
export const CAPABILITY_PACK_OPTIONS = [
  "workspace",
  "schedule",
  "lsp"
] as const;
export const DEFAULT_CAPABILITY_PACKS = [
  "workspace",
  "schedule",
  "lsp"
] as const;

export type CapabilityPackName = (typeof CAPABILITY_PACK_OPTIONS)[number];

export interface SessionSettingsRecord {
  userId: string;
  workingDirectory: string;
  model: string;
  thinkingEffort: ThinkingEffort;
  yoloMode: boolean;
  contextWindow: number;
  maxTurns: number;
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  enabledCapabilityPacks: CapabilityPackName[];
  workspaceSkillSettings: WorkspaceSkillSettingRecord[];
  userContextHooks: UserContextHookRecord[];
  debugConversationView: boolean;
  userCustomPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSettingsInput {
  workingDirectory?: string;
  model?: string;
  thinkingEffort?: ThinkingEffort;
  yoloMode?: boolean;
  contextWindow?: number;
  maxTurns?: number;
  shellAllowPatterns?: string[];
  shellDenyPatterns?: string[];
  toolAllowList?: string[];
  toolAskList?: string[];
  toolDenyList?: string[];
  enabledCapabilityPacks?: string[];
  workspaceSkillSettings?: WorkspaceSkillSettingRecord[];
  userContextHooks?: UserContextHookRecord[];
  debugConversationView?: boolean;
  userCustomPrompt?: string;
}

export function resolveSessionSettingsDefaults(
  userId = DEFAULT_SESSION_SETTINGS_USER_ID,
  options?: {
    settingsPermissionToolOptions?: readonly string[];
  }
): SessionSettingsRecord {
  const timestamp = new Date().toISOString();
  const toolAskList = [
    ...new Set(
      options?.settingsPermissionToolOptions ?? SETTINGS_PERMISSION_TOOL_OPTIONS
    )
  ];
  return {
    userId,
    workingDirectory: DEFAULT_SESSION_WORKING_DIRECTORY,
    model: DEFAULT_SESSION_MODEL,
    thinkingEffort: normalizeThinkingEffort(DEFAULT_THINKING_EFFORT),
    yoloMode: false,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTurns: DEFAULT_SESSION_MAX_TURNS,
    shellAllowPatterns: [],
    shellDenyPatterns: [],
    toolAllowList: [],
    toolAskList,
    toolDenyList: [],
    enabledCapabilityPacks: [...DEFAULT_CAPABILITY_PACKS],
    workspaceSkillSettings: [],
    userContextHooks: [],
    debugConversationView: false,
    userCustomPrompt: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function sanitizeUserCustomPrompt(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function normalizeCapabilityPacks(
  input: readonly string[] | undefined
): CapabilityPackName[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_CAPABILITY_PACKS];
  }

  const allowed = new Set<string>(CAPABILITY_PACK_OPTIONS);
  const packs = input
    .map((value) => value.trim())
    .filter((value): value is CapabilityPackName => allowed.has(value));

  return [...new Set(packs)];
}

export function normalizeSessionPermissionRules(
  input?: PermissionRuleInput | null
): PermissionRuleLists {
  return normalizePermissionRuleLists(input);
}

export function normalizeSettingsPermissionRules(
  input?: PermissionRuleInput | null,
  allowedToolNames?: readonly string[]
): PermissionRuleLists {
  return normalizeSettingsPermissionRuleLists(input, allowedToolNames);
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
