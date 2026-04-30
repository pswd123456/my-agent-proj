import {
  CAPABILITY_PACK_OPTIONS,
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS,
  USER_CONTEXT_HOOK_CONTEXT_EVENT_OPTIONS,
  USER_CONTEXT_HOOK_EVENT_OPTIONS,
  type UserContextHookRecord,
  type WorkspaceMcpConfigDiagnostic,
  type WorkspaceMcpToolLoadSummary
} from "@ai-app-template/sdk";

export const inspectorTabs = [
  { id: "prompt", label: "Prompt" },
  { id: "messages", label: "Messages" },
  { id: "thinking", label: "Thinking" },
  { id: "tools", label: "Tools" },
  { id: "trace", label: "Trace" }
] as const;

export const sidebarPanels = [
  { id: "settings", label: "Settings", title: "默认设置" },
  { id: "hooks", label: "Hooks", title: "Hooks" },
  { id: "calendar", label: "Calendar", title: "日历" },
  { id: "inspector", label: "Inspector", title: "调试详情" }
] as const;

export function clearActiveSidebarPanel(): null {
  return null;
}

export const DEFAULT_MAX_TURNS = 50;
export const MAX_TURNS_LIMIT = 200;
export const DEFAULT_CONTEXT_WINDOW = 200_000;

export type InspectorTabId = (typeof inspectorTabs)[number]["id"];
export type SidebarPanelId = (typeof sidebarPanels)[number]["id"];

export interface TurnUsageSummary {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface SettingsFormState {
  workingDirectory: string;
  model: string;
  thinkingEffort: string;
  yoloMode: boolean;
  contextWindow: string;
  maxTurns: string;
  shellAllowPatterns: string;
  shellDenyPatterns: string;
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  enabledCapabilityPacks: string[];
  userContextHooks: UserContextHookRecord[];
  debugConversationView: boolean;
  userCustomPrompt: string;
}

export interface SettingsMcpServerFormState {
  id: string;
  name: string;
  transport: "stdio" | "http";
  enabled: boolean;
  disabledTools: string[];
  status: "loaded" | "failed" | "disabled" | "unknown";
  tools: WorkspaceMcpToolLoadSummary[];
  error: string | null;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

export interface SettingsMcpFormState {
  workingDirectory: string;
  configPath: string;
  foundConfig: boolean;
  diagnostics: WorkspaceMcpConfigDiagnostic[];
  servers: SettingsMcpServerFormState[];
}

export const capabilityPackOptions = CAPABILITY_PACK_OPTIONS;
export const userContextHookBehaviorOptions =
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS;
export const userContextHookContextEventOptions =
  USER_CONTEXT_HOOK_CONTEXT_EVENT_OPTIONS;
export const userContextHookEventOptions = USER_CONTEXT_HOOK_EVENT_OPTIONS;
