import {
  CAPABILITY_PACK_OPTIONS,
  SETTINGS_PERMISSION_TOOL_OPTIONS
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
  yoloMode: boolean;
  contextWindow: string;
  maxTurns: string;
  shellAllowPatterns: string;
  shellDenyPatterns: string;
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  enabledCapabilityPacks: string[];
  debugConversationView: boolean;
}

export const permissionToolOptions = SETTINGS_PERMISSION_TOOL_OPTIONS;
export const capabilityPackOptions = CAPABILITY_PACK_OPTIONS;

export const schedulePermissionTools = new Set([
  "create_routine",
  "edit_routine",
  "delete_routine",
  "search_routine_by_oclock",
  "list_routine_by_week",
  "list_routine_by_date",
  "ask_for_confirmation"
]);

export const workspacePermissionTools = new Set([
  "apply_patch",
  "read_file",
  "list_directory",
  "find_files",
  "search_text",
  "create_directory",
  "write_file",
  "copy_path",
  "move_path",
  "delete_path",
  "git_status",
  "git_diff",
  "git_diff_cached"
]);

export function isYoloPinnedPermissionTool(toolName: string): boolean {
  return toolName !== "run_shell_command" && toolName !== "make_http_request";
}
