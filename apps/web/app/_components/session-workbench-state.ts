import type {
  RoutineRecord,
  RunStreamEvent,
  SessionSettingsRecord,
  SessionSnapshot,
  SessionSummary,
  TraceRecord
} from "@ai-app-template/sdk";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TURNS,
  MAX_TURNS_LIMIT,
  type SettingsFormState,
  type TurnUsageSummary
} from "./session-workbench-types";

type SessionDisplayStateInput = Pick<
  SessionSummary,
  | "loopState"
  | "status"
  | "pendingToolCallIds"
  | "interruptRequested"
  | "pendingPermission"
  | "pendingConfirmation"
>;

export interface SessionDisplayState {
  label: string;
  detail: string;
  tone: "neutral" | "active" | "success" | "warning" | "danger";
  isWaitingForUser: boolean;
  isActiveExecution: boolean;
}

export interface ToolRow {
  toolCallId: string;
  toolName: string;
  createdAt: string;
  input: Record<string, unknown> | null;
  output: string | null;
  displayText: string | null;
  isError: boolean;
  permissionFamily: string | null;
  permissionProfile: string | null;
  permissionSummary: string | null;
  permissionContextNote: string | null;
  permissionDecision: "requested" | "approved" | "rejected" | "blocked" | null;
  permissionReason: string | null;
}

export function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export function buildWeekRange(anchorDate: string): {
  startDate: string;
  endDate: string;
  dates: string[];
} {
  const anchor = parseDateString(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() + mondayOffset);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return formatLocalDate(value);
  });
  return {
    startDate: dates[0] ?? anchorDate,
    endDate: dates[6] ?? anchorDate,
    dates
  };
}

export function sortSessionSummaries(
  snapshots: SessionSnapshot[],
  toSummary: (session: SessionSnapshot) => SessionSummary
): SessionSummary[] {
  return snapshots
    .map(toSummary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function mergeSessionSummary(
  sessions: SessionSummary[],
  session: SessionSnapshot,
  toSummary: (session: SessionSnapshot) => SessionSummary
): SessionSummary[] {
  const next = sessions.filter((item) => item.sessionId !== session.sessionId);
  next.unshift(toSummary(session));
  return next.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function isReusableNewSessionSummary(session: SessionSummary): boolean {
  return (
    session.status === "waiting_for_user_input" &&
    session.loopState === "waiting for input" &&
    session.turnCount === 0 &&
    session.pendingToolCallIds.length === 0 &&
    !session.interruptRequested &&
    !session.pendingPermission &&
    !session.pendingConfirmation &&
    session.lastUserMessage === null
  );
}

export function findReusableNewSessionSummary(
  sessions: SessionSummary[]
): SessionSummary | null {
  return sessions.find(isReusableNewSessionSummary) ?? null;
}

export function getSessionDisplayState(
  session: SessionDisplayStateInput
): SessionDisplayState {
  if (session.interruptRequested) {
    return {
      label: "停止中",
      detail: "已请求中断，正在等待 runtime 停到安全边界。",
      tone: "warning",
      isWaitingForUser: false,
      isActiveExecution: true
    };
  }

  if (
    session.pendingPermission ||
    session.status === "waiting_for_permission"
  ) {
    return {
      label: "等待权限确认",
      detail: "工具调用已暂停，需要先处理权限请求。",
      tone: "warning",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  if (
    session.pendingConfirmation ||
    session.status === "waiting_for_conflict_confirmation"
  ) {
    return {
      label: "等待冲突确认",
      detail: "检测到日程冲突，需要确认后继续执行。",
      tone: "warning",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  if (session.loopState === "waiting for tool result") {
    const pendingCount = session.pendingToolCallIds.length;
    return {
      label:
        pendingCount > 0 ? `等待工具结果 · ${pendingCount}` : "等待工具结果",
      detail: "模型已发起工具调用，runtime 正在等待工具返回。",
      tone: "active",
      isWaitingForUser: false,
      isActiveExecution: true
    };
  }

  if (session.loopState === "running" || session.status === "running") {
    return {
      label: "执行中",
      detail: "模型或 runtime 正在处理当前请求。",
      tone: "active",
      isWaitingForUser: false,
      isActiveExecution: true
    };
  }

  if (session.loopState === "interrupted") {
    return {
      label: "已中断",
      detail: "本轮执行已被中断，可以继续发送新请求。",
      tone: "warning",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  if (session.loopState === "failed" || session.status === "failed") {
    return {
      label: "失败",
      detail: "本轮执行失败，请查看错误或 trace 后继续。",
      tone: "danger",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  if (session.loopState === "completed" || session.status === "completed") {
    return {
      label: "已完成",
      detail: "本轮执行已完成，可以继续发送新请求。",
      tone: "success",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  if (session.loopState === "waiting for input") {
    return {
      label: "等待输入",
      detail: "会话空闲，正在等待下一条用户输入。",
      tone: "neutral",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  return {
    label: "空闲",
    detail: "会话尚未开始执行。",
    tone: "neutral",
    isWaitingForUser: true,
    isActiveExecution: false
  };
}

export function canInterruptSessionExecution(input: {
  session: SessionSnapshot | null;
  submitting: boolean;
  interruptingSessionId?: string | null;
}): boolean {
  const { session, submitting, interruptingSessionId } = input;
  if (!session) {
    return false;
  }

  if (
    submitting ||
    interruptingSessionId === session.sessionId ||
    session.sessionState.interruptRequested
  ) {
    return true;
  }

  const displayState = getSessionDisplayState({
    loopState: session.sessionState.loopState,
    status: session.context.status,
    pendingToolCallIds: session.sessionState.pendingToolCallIds,
    interruptRequested: session.sessionState.interruptRequested,
    pendingPermission: Boolean(session.context.pendingPermissionRequest),
    pendingConfirmation: Boolean(session.context.pendingConfirmationPayload)
  });

  if (!displayState.isActiveExecution) {
    return false;
  }

  return true;
}

export function flattenTraceRecords(records: TraceRecord[]): RunStreamEvent[] {
  return records.map((record) => ({
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    ...record.event
  })) as RunStreamEvent[];
}

export function collectTurnUsage(
  events: RunStreamEvent[]
): Map<number, TurnUsageSummary> {
  const usageByTurn = new Map<number, TurnUsageSummary>();

  for (const event of events) {
    if (event.kind !== "response") {
      continue;
    }

    const current = usageByTurn.get(event.turnCount) ?? {
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0
    };

    usageByTurn.set(event.turnCount, {
      inputTokens: current.inputTokens + event.usage.inputTokens,
      cacheReadInputTokens:
        current.cacheReadInputTokens + event.usage.cacheReadInputTokens,
      cacheCreationInputTokens:
        current.cacheCreationInputTokens + event.usage.cacheCreationInputTokens
    });
  }

  return usageByTurn;
}

export function collectToolRows(events: RunStreamEvent[]): ToolRow[] {
  const rows: ToolRow[] = [];

  for (const event of events) {
    if (event.kind === "tool_call") {
      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: event.input,
        output: null,
        displayText: null,
        isError: false,
        permissionFamily: null,
        permissionProfile: null,
        permissionSummary: null,
        permissionContextNote: null,
        permissionDecision: null,
        permissionReason: null
      });
      continue;
    }

    if (event.kind === "permission_request") {
      const existing = rows.find((row) => row.toolCallId === event.toolCallId);
      if (existing) {
        existing.permissionFamily = event.request.family;
        existing.permissionProfile = event.request.permissionProfile;
        existing.permissionSummary = event.request.summaryText;
        existing.permissionContextNote = event.request.contextNote ?? null;
        existing.permissionDecision = "requested";
        continue;
      }

      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: null,
        output: null,
        displayText: null,
        isError: false,
        permissionFamily: event.request.family,
        permissionProfile: event.request.permissionProfile,
        permissionSummary: event.request.summaryText,
        permissionContextNote: event.request.contextNote ?? null,
        permissionDecision: "requested",
        permissionReason: null
      });
      continue;
    }

    if (
      event.kind === "permission_approved" ||
      event.kind === "permission_rejected"
    ) {
      const existing = rows.find((row) => row.toolCallId === event.toolCallId);
      if (existing) {
        existing.permissionFamily = event.request.family;
        existing.permissionProfile = event.request.permissionProfile;
        existing.permissionSummary = event.request.summaryText;
        existing.permissionContextNote = event.request.contextNote ?? null;
        existing.permissionDecision =
          event.kind === "permission_approved" ? "approved" : "rejected";
        continue;
      }

      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: null,
        output: null,
        displayText: null,
        isError: event.kind === "permission_rejected",
        permissionFamily: event.request.family,
        permissionProfile: event.request.permissionProfile,
        permissionSummary: event.request.summaryText,
        permissionContextNote: event.request.contextNote ?? null,
        permissionDecision:
          event.kind === "permission_approved" ? "approved" : "rejected",
        permissionReason: null
      });
      continue;
    }

    if (event.kind === "permission_blocked") {
      const existing = rows.find((row) => row.toolCallId === event.toolCallId);
      if (existing) {
        existing.permissionDecision = "blocked";
        existing.permissionReason = event.reason;
        existing.isError = true;
        continue;
      }

      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: null,
        output: null,
        displayText: null,
        isError: true,
        permissionFamily: null,
        permissionProfile: null,
        permissionSummary: null,
        permissionContextNote: null,
        permissionDecision: "blocked",
        permissionReason: event.reason
      });
      continue;
    }

    if (event.kind !== "tool_result") {
      continue;
    }

    const existing = rows.find((row) => row.toolCallId === event.toolCallId);
    if (existing) {
      existing.output = event.output;
      existing.displayText = event.displayText ?? null;
      existing.isError = event.isError;
      continue;
    }

    rows.push({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      createdAt: event.createdAt,
      input: null,
      output: event.output,
      displayText: event.displayText ?? null,
      isError: event.isError,
      permissionFamily: null,
      permissionProfile: null,
      permissionSummary: null,
      permissionContextNote: null,
      permissionDecision: null,
      permissionReason: null
    });
  }

  return rows;
}

export function normalizeMaxTurns(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_MAX_TURNS;
  }

  return Math.min(MAX_TURNS_LIMIT, Math.max(1, parsed));
}

export function normalizeContextWindow(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_CONTEXT_WINDOW;
  }

  return Math.max(1_000, parsed);
}

export function toSettingsFormState(
  settings: SessionSettingsRecord | null
): SettingsFormState {
  return {
    workingDirectory: settings?.workingDirectory ?? "",
    yoloMode: settings?.yoloMode ?? false,
    contextWindow: String(settings?.contextWindow ?? DEFAULT_CONTEXT_WINDOW),
    maxTurns: String(settings?.maxTurns ?? DEFAULT_MAX_TURNS),
    shellAllowPatterns: (settings?.shellAllowPatterns ?? []).join("\n"),
    shellDenyPatterns: (settings?.shellDenyPatterns ?? []).join("\n"),
    toolAllowList: [...(settings?.toolAllowList ?? [])],
    toolAskList: [...(settings?.toolAskList ?? [])],
    toolDenyList: [...(settings?.toolDenyList ?? [])],
    enabledCapabilityPacks: [...(settings?.enabledCapabilityPacks ?? [])]
  };
}

export function patchSettingsForm(
  current: SettingsFormState,
  patch: Partial<SettingsFormState>
): SettingsFormState {
  return {
    ...current,
    ...patch
  };
}

export function normalizeSettingsFormState(
  form: SettingsFormState
): SettingsFormState {
  return {
    workingDirectory: form.workingDirectory.trim(),
    yoloMode: form.yoloMode,
    contextWindow: String(normalizeContextWindow(form.contextWindow)),
    maxTurns: String(normalizeMaxTurns(form.maxTurns)),
    shellAllowPatterns: normalizePatternText(form.shellAllowPatterns),
    shellDenyPatterns: normalizePatternText(form.shellDenyPatterns),
    toolAllowList: normalizeList(form.toolAllowList),
    toolAskList: normalizeList(form.toolAskList),
    toolDenyList: normalizeList(form.toolDenyList),
    enabledCapabilityPacks: normalizeList(form.enabledCapabilityPacks)
  };
}

export function normalizePatternText(value: string): string {
  return normalizeList(value.split(/\r?\n/)).join("\n");
}

export function normalizeList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function splitPatternLines(value: string): string[] {
  return normalizeList(value.split(/\r?\n/));
}

export function groupRoutinesByDate(
  routines: RoutineRecord[]
): Map<string, RoutineRecord[]> {
  const grouped = new Map<string, RoutineRecord[]>();
  for (const routine of routines) {
    const current = grouped.get(routine.date) ?? [];
    current.push(routine);
    current.sort((left, right) => left.startAt.localeCompare(right.startAt));
    grouped.set(routine.date, current);
  }
  return grouped;
}
