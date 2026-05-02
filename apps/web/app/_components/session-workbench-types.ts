import {
  CAPABILITY_PACK_OPTIONS,
  type UserSettingsSkillsPayload,
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS,
  USER_CONTEXT_HOOK_CONTEXT_EVENT_OPTIONS,
  USER_CONTEXT_HOOK_EVENT_OPTIONS,
  USER_CONTEXT_HOOK_WAIT_MODE_OPTIONS,
  type UserContextHookRecord,
  type WorkspaceSkillSettingRecord,
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
  { id: "calendar", label: "Calendar", title: "日历" },
  { id: "inspector", label: "Inspector", title: "调试详情" }
] as const;

export const settingsPages = [
  {
    id: "general",
    label: "常规",
    title: "常规",
    description: "默认工作目录、执行预算与会话历史。"
  },
  {
    id: "permissions",
    label: "权限",
    title: "权限",
    description: "Shell 规则、能力包与工具默认策略。"
  },
  {
    id: "mcp",
    label: "MCP",
    title: "MCP 服务",
    description: "工作目录下的 MCP server 与工具挂载。"
  },
  {
    id: "skills",
    label: "Skills",
    title: "Skills",
    description: "当前工作目录下 skills 的启用状态。"
  },
  {
    id: "hooks",
    label: "Hooks",
    title: "Hooks",
    description: "不同 runtime 时机的 context 注入与自动消息。"
  },
  {
    id: "personalization",
    label: "个性化",
    title: "个性化",
    description: "长期提示与稳定偏好。"
  }
] as const;

export function clearActiveSidebarPanel(): null {
  return null;
}

export const DEFAULT_MAX_TURNS = 100;
export const MAX_TURNS_LIMIT = 200;
export const DEFAULT_CONTEXT_WINDOW = 200_000;

export type InspectorTabId = (typeof inspectorTabs)[number]["id"];
export type SidebarPanelId = "settings" | "hooks" | "calendar" | "inspector";
export type SettingsPageId = (typeof settingsPages)[number]["id"];

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
  workspaceSkillSettings: WorkspaceSkillSettingRecord[];
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

export interface SettingsSkillsState {
  workingDirectory: string;
  skills: UserSettingsSkillsPayload["skills"];
  diagnostics: UserSettingsSkillsPayload["diagnostics"];
}

export const capabilityPackOptions = CAPABILITY_PACK_OPTIONS;
export const userContextHookBehaviorOptions =
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS;
export const userContextHookContextEventOptions =
  USER_CONTEXT_HOOK_CONTEXT_EVENT_OPTIONS;
export const userContextHookEventOptions = USER_CONTEXT_HOOK_EVENT_OPTIONS;
export const userContextHookWaitModeOptions =
  USER_CONTEXT_HOOK_WAIT_MODE_OPTIONS;
