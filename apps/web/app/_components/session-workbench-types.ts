import {
  CAPABILITY_PACK_OPTIONS,
  type CronIntervalUnit,
  type CronJobRecord,
  type CronJobStatus,
  type CronScheduleMode,
  type CronWeekday,
  type CreateCronJobPayload,
  type ModelCatalogEntry,
  type SessionSummary,
  type UpdateCronJobPayload,
  type UserSettingsSkillsPayload,
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS,
  USER_CONTEXT_HOOK_CONTEXT_EVENT_OPTIONS,
  USER_CONTEXT_HOOK_EVENT_OPTIONS,
  USER_CONTEXT_HOOK_WAIT_MODE_OPTIONS,
  type UserContextHookRecord,
  type UserSettingsChannelsPayload,
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
  { id: "settings", label: "Settings", title: "设置" },
  { id: "cron", label: "Cron", title: "定时任务" },
  { id: "cron-create", label: "New Cron", title: "新建定时任务" },
  { id: "inspector", label: "Inspector", title: "调试详情" }
] as const;

export function getSidebarPanels(debugConversationView: boolean) {
  if (debugConversationView) {
    return sidebarPanels;
  }

  return sidebarPanels.filter((panel) => panel.id !== "inspector");
}

export const settingsPages = [
  {
    id: "general",
    label: "常规",
    title: "常规",
    description: "默认工作目录、执行预算与会话历史。"
  },
  {
    id: "calendar",
    label: "日历",
    title: "日历",
    description: "查看当前工作周日程并重置全部日程。"
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
    id: "channels",
    label: "Channels",
    title: "Channels",
    description: "当前工作目录下的外部消息通道。"
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
export type SidebarPanelId = "settings" | "cron" | "cron-create" | "inspector";
export type SettingsPageId = (typeof settingsPages)[number]["id"];

export interface WorkbenchSessionSummary extends SessionSummary {
  cronJobId?: string | null;
}

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

export interface SettingsChannelsState {
  workingDirectory: string;
  configPath: string;
  foundConfig: boolean;
  telegram: UserSettingsChannelsPayload["telegram"];
  telegramBindings: UserSettingsChannelsPayload["telegramBindings"];
  diagnostics: UserSettingsChannelsPayload["diagnostics"];
}

export type CronMaxRunsMode = "infinite" | "finite";

export interface CronJobFormState {
  name: string;
  prompt: string;
  workingDirectory: string;
  model: string;
  thinkingEffort: string;
  status: CronJobStatus;
  maxRunsMode: CronMaxRunsMode;
  maxRuns: string;
  scheduleMode: CronScheduleMode;
  intervalUnit: CronIntervalUnit;
  intervalValue: string;
  weekday: CronWeekday;
  timeOfDay: string;
  startsAt: string;
}

export const cronScheduleModeOptions = [
  { value: "interval", label: "间隔" },
  { value: "weekly", label: "每周" }
] as const;

export const cronIntervalUnitOptions = [
  { value: "minute", label: "分钟" },
  { value: "hour", label: "小时" },
  { value: "day", label: "天" }
] as const;

export const cronWeekdayOptions = [
  { value: "monday", label: "周一" },
  { value: "tuesday", label: "周二" },
  { value: "wednesday", label: "周三" },
  { value: "thursday", label: "周四" },
  { value: "friday", label: "周五" },
  { value: "saturday", label: "周六" },
  { value: "sunday", label: "周日" }
] as const;

export const cronStatusOptions = [
  { value: "active", label: "启用" },
  { value: "paused", label: "暂停" },
  { value: "completed", label: "已完成" }
] as const;

function formatLocalDateTimeValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatDateTimeLocalInput(
  value: string | null | undefined
): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }
  return formatLocalDateTimeValue(parsed);
}

export function createDefaultCronJobFormState(
  input: {
    workingDirectory?: string | null;
    startsAt?: string;
  } = {}
): CronJobFormState {
  const now = new Date();
  now.setSeconds(0, 0);
  return {
    name: "",
    prompt: "",
    workingDirectory: input.workingDirectory?.trim() ?? "",
    model: "",
    thinkingEffort: "",
    status: "active",
    maxRunsMode: "infinite",
    maxRuns: "",
    scheduleMode: "interval",
    intervalUnit: "day",
    intervalValue: "1",
    weekday: "monday",
    timeOfDay: "09:00",
    startsAt: input.startsAt ?? formatLocalDateTimeValue(now)
  };
}

export function toCronJobFormState(cronJob: CronJobRecord): CronJobFormState {
  return {
    name: cronJob.name,
    prompt: cronJob.prompt,
    workingDirectory: cronJob.workingDirectory,
    model: cronJob.modelOverride ?? "",
    thinkingEffort: cronJob.thinkingEffortOverride ?? "",
    status: cronJob.status,
    maxRunsMode: cronJob.maxRuns === null ? "infinite" : "finite",
    maxRuns: cronJob.maxRuns === null ? "" : String(cronJob.maxRuns),
    scheduleMode: cronJob.scheduleMode,
    intervalUnit: cronJob.intervalUnit ?? "day",
    intervalValue:
      cronJob.intervalValue === null ? "1" : String(cronJob.intervalValue),
    weekday: cronJob.weekday ?? "monday",
    timeOfDay: cronJob.timeOfDay ?? "09:00",
    startsAt: formatDateTimeLocalInput(cronJob.startsAt)
  };
}

function resolveFiniteRunCount(
  mode: CronMaxRunsMode,
  value: string
): number | null {
  if (mode === "infinite") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function buildCreateCronJobPayload(
  form: CronJobFormState
): CreateCronJobPayload {
  const base = {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    workingDirectory: form.workingDirectory.trim(),
    startsAt: form.startsAt,
    maxRuns: resolveFiniteRunCount(form.maxRunsMode, form.maxRuns),
    ...(form.model.trim() ? { model: form.model.trim() } : {}),
    ...(form.thinkingEffort
      ? { thinkingEffort: form.thinkingEffort as "high" | "max" }
      : {}),
    ...(form.status ? { status: form.status } : {})
  };

  if (form.scheduleMode === "weekly") {
    return {
      ...base,
      scheduleMode: "weekly",
      weekday: form.weekday,
      timeOfDay: form.timeOfDay
    };
  }

  return {
    ...base,
    scheduleMode: "interval",
    intervalUnit: form.intervalUnit,
    intervalValue: Number.parseInt(form.intervalValue, 10) || 1
  };
}

export function buildUpdateCronJobPayload(
  form: CronJobFormState
): UpdateCronJobPayload {
  const base = {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    workingDirectory: form.workingDirectory.trim(),
    startsAt: form.startsAt,
    maxRuns: resolveFiniteRunCount(form.maxRunsMode, form.maxRuns),
    model: form.model.trim() ? form.model.trim() : null,
    thinkingEffort: form.thinkingEffort
      ? (form.thinkingEffort as "high" | "max")
      : null,
    status: form.status
  };

  if (form.scheduleMode === "weekly") {
    return {
      ...base,
      scheduleMode: "weekly",
      weekday: form.weekday,
      timeOfDay: form.timeOfDay
    };
  }

  return {
    ...base,
    scheduleMode: "interval",
    intervalUnit: form.intervalUnit,
    intervalValue: Number.parseInt(form.intervalValue, 10) || 1
  };
}

export function resolveModelThinkingEffortOptions(input: {
  modelCatalog: ModelCatalogEntry[];
  modelId: string;
}): string[] {
  return (
    input.modelCatalog.find((item) => item.id === input.modelId)
      ?.thinkingEfforts ?? []
  );
}

export const capabilityPackOptions = CAPABILITY_PACK_OPTIONS;
export const userContextHookBehaviorOptions =
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS;
export const userContextHookContextEventOptions =
  USER_CONTEXT_HOOK_CONTEXT_EVENT_OPTIONS;
export const userContextHookEventOptions = USER_CONTEXT_HOOK_EVENT_OPTIONS;
export const userContextHookWaitModeOptions =
  USER_CONTEXT_HOOK_WAIT_MODE_OPTIONS;
