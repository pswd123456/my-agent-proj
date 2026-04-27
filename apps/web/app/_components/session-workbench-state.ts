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
import { applyTodoToolResultToSession } from "./session-todo-state";

type SessionDisplayStateInput = Pick<
  SessionSummary,
  | "loopState"
  | "status"
  | "pendingToolCallIds"
  | "interruptRequested"
  | "pendingPermission"
  | "pendingConfirmation"
  | "pendingUserQuestion"
  | "pendingBackgroundNotificationCount"
  | "activeBackgroundTaskCount"
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
  turnCount: number | null;
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

export interface SessionSidebarRow {
  session: SessionSummary;
  depth: number;
  childCount: number;
}

export const DEFAULT_VISIBLE_SESSION_ROW_COUNT = 20;

function sortSessionSummariesByFreshness(
  sessions: SessionSummary[]
): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
    if (byUpdatedAt !== 0) {
      return byUpdatedAt;
    }

    return right.sessionId.localeCompare(left.sessionId);
  });
}

export function buildSessionSidebarRows(
  sessions: SessionSummary[]
): SessionSidebarRow[] {
  const sessionsById = new Map(
    sessions.map((session) => [session.sessionId, session] as const)
  );
  const childrenByParentId = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const parentSessionId = session.parentSessionId?.trim() ?? null;
    if (
      !parentSessionId ||
      parentSessionId === session.sessionId ||
      !sessionsById.has(parentSessionId)
    ) {
      continue;
    }

    const children = childrenByParentId.get(parentSessionId) ?? [];
    children.push(session);
    childrenByParentId.set(parentSessionId, children);
  }

  const rows: SessionSidebarRow[] = [];
  const visited = new Set<string>();

  function append(session: SessionSummary, depth: number): void {
    if (visited.has(session.sessionId)) {
      return;
    }

    visited.add(session.sessionId);
    const children = sortSessionSummariesByFreshness(
      childrenByParentId.get(session.sessionId) ?? []
    );

    rows.push({
      session,
      depth,
      childCount: children.length
    });

    for (const child of children) {
      append(child, depth + 1);
    }
  }

  const rootSessions = sortSessionSummariesByFreshness(
    sessions.filter((session) => {
      const parentSessionId = session.parentSessionId?.trim() ?? null;
      return (
        !parentSessionId ||
        parentSessionId === session.sessionId ||
        !sessionsById.has(parentSessionId)
      );
    })
  );

  for (const session of rootSessions) {
    append(session, 0);
  }

  for (const session of sortSessionSummariesByFreshness(sessions)) {
    append(session, 0);
  }

  return rows;
}

export function getSessionSidebarPageIndex(
  rows: SessionSidebarRow[],
  input: {
    selectedSessionId: string | null;
    visibleCount?: number;
  }
): number {
  const visibleCount = Math.max(
    1,
    input.visibleCount ?? DEFAULT_VISIBLE_SESSION_ROW_COUNT
  );
  const selectedIndex =
    input.selectedSessionId === null
      ? -1
      : rows.findIndex(
          (row) => row.session.sessionId === input.selectedSessionId
        );

  if (selectedIndex < 0) {
    return 0;
  }

  return Math.floor(selectedIndex / visibleCount);
}

export function getVisibleSessionSidebarRows(
  rows: SessionSidebarRow[],
  input: {
    visibleCount?: number;
    pageCount?: number;
  }
): SessionSidebarRow[] {
  const visibleCountPerPage = Math.max(
    1,
    input.visibleCount ?? DEFAULT_VISIBLE_SESSION_ROW_COUNT
  );
  const pageCount = Math.max(1, input.pageCount ?? 1);
  return rows.slice(0, visibleCountPerPage * pageCount);
}

export function applyStreamEventToSession(
  session: SessionSnapshot,
  event: RunStreamEvent
): SessionSnapshot {
  switch (event.kind) {
    case "turn_start":
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          ...event.session.sessionState,
          loopState: "running",
          interruptRequested: false
        },
        context: {
          ...session.context,
          status: "running"
        }
      };
    case "tool_call": {
      const nextPending = new Set(session.sessionState.pendingToolCallIds);
      nextPending.add(event.toolCallId);
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          loopState: "waiting for tool result",
          pendingToolCallIds: [...nextPending]
        },
        context: {
          ...session.context,
          status: "running"
        }
      };
    }
    case "tool_result": {
      const nextPending = session.sessionState.pendingToolCallIds.filter(
        (id) => id !== event.toolCallId
      );
      const nextSession = applyTodoToolResultToSession(session, event);
      return {
        ...nextSession,
        sessionState: {
          ...nextSession.sessionState,
          loopState:
            nextPending.length > 0 ? "waiting for tool result" : "running",
          pendingToolCallIds: nextPending
        },
        context: {
          ...nextSession.context,
          status: "running"
        }
      };
    }
    case "permission_request":
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          loopState: "waiting for input"
        },
        context: {
          ...session.context,
          status: "waiting_for_permission",
          pendingPermissionRequest: event.request
        }
      };
    case "permission_approved": {
      const nextPending = new Set(session.sessionState.pendingToolCallIds);
      nextPending.add(event.toolCallId);
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          loopState: "waiting for tool result",
          pendingToolCallIds: [...nextPending]
        },
        context: {
          ...session.context,
          status: "running",
          pendingPermissionRequest: null
        }
      };
    }
    case "permission_rejected":
    case "permission_blocked":
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          loopState: "waiting for input"
        },
        context: {
          ...session.context,
          status: "waiting_for_user_input",
          pendingPermissionRequest: null
        }
      };
    case "user_question_request":
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          loopState: "waiting for input",
          pendingToolCallIds: []
        },
        context: {
          ...session.context,
          status: "waiting_for_user_question",
          pendingUserQuestionPayload: event.question
        }
      };
    case "interrupt_requested":
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          interruptRequested: true
        }
      };
    case "interrupted":
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          loopState: "interrupted",
          interruptRequested: false,
          pendingToolCallIds: []
        },
        context: {
          ...session.context,
          status: "waiting_for_user_input",
          pendingPermissionRequest: null
        }
      };
    case "turn_end":
      return {
        ...session,
        sessionState: {
          ...session.sessionState,
          loopState: event.loopState,
          interruptRequested: false,
          pendingToolCallIds:
            event.loopState === "waiting for tool result"
              ? session.sessionState.pendingToolCallIds
              : []
        },
        context: {
          ...session.context,
          status:
            event.loopState === "completed"
              ? "completed"
              : event.loopState === "failed"
                ? "failed"
                : event.loopState === "interrupted"
                  ? "waiting_for_user_input"
                  : event.loopState === "waiting for input"
                    ? session.context.pendingUserQuestionPayload
                      ? "waiting_for_user_question"
                      : "waiting_for_user_input"
                    : "running",
          pendingPermissionRequest:
            event.loopState === "waiting for input"
              ? session.context.pendingPermissionRequest
              : null
        }
      };
    case "run_complete":
      return event.session;
    case "run_error":
      return "session" in event ? (event.session ?? session) : session;
    default:
      return session;
  }
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
    !session.pendingUserQuestion &&
    session.pendingBackgroundNotificationCount === 0 &&
    session.activeBackgroundTaskCount === 0 &&
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
  if (session.loopState === "waiting for tool result") {
    const pendingCount = session.pendingToolCallIds.length;
    return {
      label: pendingCount > 0 ? `等待工具结果 · ${pendingCount}` : "执行中",
      detail: "工具调用已获准，runtime 正在继续执行当前请求。",
      tone: "active",
      isWaitingForUser: false,
      isActiveExecution: true
    };
  }

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

  if (
    session.pendingUserQuestion ||
    session.status === "waiting_for_user_question"
  ) {
    return {
      label: "等待澄清",
      detail: "规划已暂停，正在等待用户补充关键信息。",
      tone: "warning",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  if (session.pendingBackgroundNotificationCount > 0) {
    const hasBackgroundFailure = session.status === "failed";
    return {
      label: hasBackgroundFailure ? "后台失败待收口" : "有待处理后台更新",
      detail: hasBackgroundFailure
        ? "后台任务已失败或超时，主会话仍有待处理的收口通知。"
        : "后台子任务已有结果回注到当前会话，等待主代理或用户继续处理。",
      tone: hasBackgroundFailure ? "danger" : "warning",
      isWaitingForUser: true,
      isActiveExecution: false
    };
  }

  if (session.activeBackgroundTaskCount > 0) {
    return {
      label: `后台处理中 · ${session.activeBackgroundTaskCount}`,
      detail: "已有子任务在后台继续执行，完成后会自动回注到当前会话。",
      tone: "active",
      isWaitingForUser: true,
      isActiveExecution: false
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
    label: "等待输入",
    detail: "会话空闲，正在等待下一条用户输入。",
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
    pendingConfirmation: Boolean(session.context.pendingConfirmationPayload),
    pendingUserQuestion: Boolean(session.context.pendingUserQuestionPayload),
    pendingBackgroundNotificationCount:
      session.context.pendingBackgroundNotifications?.length ?? 0,
    activeBackgroundTaskCount: session.context.activeBackgroundTaskCount ?? 0
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
        turnCount: event.turnCount,
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
        turnCount: event.turnCount,
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
        turnCount: event.turnCount,
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
        turnCount: event.turnCount,
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
      turnCount: event.turnCount,
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
    model: settings?.model ?? "",
    yoloMode: settings?.yoloMode ?? false,
    contextWindow: String(settings?.contextWindow ?? DEFAULT_CONTEXT_WINDOW),
    maxTurns: String(settings?.maxTurns ?? DEFAULT_MAX_TURNS),
    shellAllowPatterns: (settings?.shellAllowPatterns ?? []).join("\n"),
    shellDenyPatterns: (settings?.shellDenyPatterns ?? []).join("\n"),
    toolAllowList: [...(settings?.toolAllowList ?? [])],
    toolAskList: [...(settings?.toolAskList ?? [])],
    toolDenyList: [...(settings?.toolDenyList ?? [])],
    enabledCapabilityPacks: [...(settings?.enabledCapabilityPacks ?? [])],
    debugConversationView: settings?.debugConversationView ?? false
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
    model: form.model.trim(),
    yoloMode: form.yoloMode,
    contextWindow: String(normalizeContextWindow(form.contextWindow)),
    maxTurns: String(normalizeMaxTurns(form.maxTurns)),
    shellAllowPatterns: normalizePatternText(form.shellAllowPatterns),
    shellDenyPatterns: normalizePatternText(form.shellDenyPatterns),
    toolAllowList: normalizeList(form.toolAllowList),
    toolAskList: normalizeList(form.toolAskList),
    toolDenyList: normalizeList(form.toolDenyList),
    enabledCapabilityPacks: normalizeList(form.enabledCapabilityPacks),
    debugConversationView: form.debugConversationView
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
