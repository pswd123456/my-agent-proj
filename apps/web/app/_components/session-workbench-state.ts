import type {
  RoutineRecord,
  RunStreamEvent,
  UpdateSessionSettingsPayload,
  UpdateUserSettingsPayload,
  SessionSettingsRecord,
  SessionSnapshot,
  SessionSummary,
  TraceRecord,
  UserContextHookRecord,
  UserSettingsMcpPayload,
  UserSettingsSkillsPayload,
  WorkspaceSkillSettingRecord,
  WorkspaceMcpServerConfig
} from "@ai-app-template/sdk";
import {
  findDuplicateWorkspaceMcpServerNames,
  normalizeWorkspaceMcpServerConfig,
  USER_CONTEXT_HOOK_TYPES,
  getUserContextHookTypeKey
} from "@ai-app-template/sdk";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TURNS,
  MAX_TURNS_LIMIT,
  type SettingsMcpFormState,
  type SettingsMcpServerFormState,
  type SettingsFormState,
  type SettingsSkillsState,
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
  return sortSessionSummariesByFreshness(snapshots.map(toSummary));
}

export function mergeSessionSummary(
  sessions: SessionSummary[],
  session: SessionSnapshot,
  toSummary: (session: SessionSnapshot) => SessionSummary
): SessionSummary[] {
  const next = sessions.filter((item) => item.sessionId !== session.sessionId);
  next.unshift(toSummary(session));
  return sortSessionSummariesByFreshness(next);
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
  return [...sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function buildSessionSidebarRows(
  sessions: SessionSummary[],
  options: {
    debugConversationView?: boolean;
  } = {}
): SessionSidebarRow[] {
  const visibleSessions = sessions.filter(
    (session) =>
      options.debugConversationView === true ||
      session.parentSessionTaskKind !== "hook_subagent"
  );
  const sessionsById = new Map(
    visibleSessions.map((session) => [session.sessionId, session] as const)
  );
  const childrenByParentId = new Map<string, SessionSummary[]>();

  for (const session of visibleSessions) {
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
    visibleSessions.filter((session) => {
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

  for (const session of sortSessionSummariesByFreshness(visibleSessions)) {
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
    collapsedSessionIds?: Set<string>;
  }
): SessionSidebarRow[] {
  const visibleCountPerPage = Math.max(
    1,
    input.visibleCount ?? DEFAULT_VISIBLE_SESSION_ROW_COUNT
  );
  const pageCount = Math.max(1, input.pageCount ?? 1);
  const collapsedSessionIds = input.collapsedSessionIds ?? null;

  if (!collapsedSessionIds || collapsedSessionIds.size === 0) {
    return rows.slice(0, visibleCountPerPage * pageCount);
  }

  const visibleRows: SessionSidebarRow[] = [];
  const ancestorStack: Array<{ sessionId: string; collapsed: boolean }> = [];

  for (const row of rows) {
    while (ancestorStack.length > row.depth) {
      ancestorStack.pop();
    }

    const hidden = ancestorStack.some((ancestor) => ancestor.collapsed);
    ancestorStack[row.depth] = {
      sessionId: row.session.sessionId,
      collapsed:
        row.childCount > 0 && collapsedSessionIds.has(row.session.sessionId)
    };

    if (!hidden) {
      visibleRows.push(row);
    }
  }

  return visibleRows.slice(0, visibleCountPerPage * pageCount);
}

export function getAutoCollapsedSessionIds(
  rows: SessionSidebarRow[]
): Set<string> {
  const collapsedSessionIds = new Set<string>();

  for (const row of rows) {
    if (row.childCount === 0) {
      continue;
    }

    if (
      row.session.loopState === "completed" ||
      row.session.status === "completed"
    ) {
      collapsedSessionIds.add(row.session.sessionId);
    }
  }

  return collapsedSessionIds;
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

  if (
    session.sessionState.loopState === "interrupted" ||
    session.sessionState.loopState === "failed" ||
    session.sessionState.loopState === "completed" ||
    session.context.status === "failed" ||
    session.context.status === "completed"
  ) {
    return false;
  }

  const isIdle =
    session.sessionState.loopState === "waiting for input" &&
    session.context.status === "waiting_for_user_input" &&
    session.sessionState.pendingToolCallIds.length === 0 &&
    !session.context.pendingPermissionRequest &&
    !session.context.pendingConfirmationPayload &&
    !session.context.pendingUserQuestionPayload;
  if (isIdle) {
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
    thinkingEffort: settings?.thinkingEffort ?? "high",
    yoloMode: settings?.yoloMode ?? false,
    contextWindow: String(settings?.contextWindow ?? DEFAULT_CONTEXT_WINDOW),
    maxTurns: String(settings?.maxTurns ?? DEFAULT_MAX_TURNS),
    shellAllowPatterns: (settings?.shellAllowPatterns ?? []).join("\n"),
    shellDenyPatterns: (settings?.shellDenyPatterns ?? []).join("\n"),
    toolAllowList: [...(settings?.toolAllowList ?? [])],
    toolAskList: [...(settings?.toolAskList ?? [])],
    toolDenyList: [...(settings?.toolDenyList ?? [])],
    enabledCapabilityPacks: [...(settings?.enabledCapabilityPacks ?? [])],
    workspaceSkillSettings: [...(settings?.workspaceSkillSettings ?? [])],
    userContextHooks: [...(settings?.userContextHooks ?? [])],
    debugConversationView: settings?.debugConversationView ?? false,
    userCustomPrompt: settings?.userCustomPrompt ?? ""
  };
}

function formatRecordText(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function formatMcpServerFormState(
  server: WorkspaceMcpServerConfig,
  statuses: NonNullable<UserSettingsMcpPayload["serverStatuses"]>,
  index: number
): SettingsMcpServerFormState {
  const status = statuses.find((item) => item.name === server.name);

  if (server.transport === "stdio") {
    return {
      id: `${server.name || "stdio"}-${index}`,
      name: server.name,
      transport: "stdio",
      enabled: server.enabled,
      disabledTools: [...server.disabledTools],
      status: status?.status ?? "unknown",
      tools: status?.tools ?? [],
      error: status?.error ?? null,
      command: server.command,
      args: server.args.join("\n"),
      env: formatRecordText(server.env),
      url: "",
      headers: ""
    };
  }

  return {
    id: `${server.name || "http"}-${index}`,
    name: server.name,
    transport: "http",
    enabled: server.enabled,
    disabledTools: [...server.disabledTools],
    status: status?.status ?? "unknown",
    tools: status?.tools ?? [],
    error: status?.error ?? null,
    command: "",
    args: "",
    env: "",
    url: server.url,
    headers: formatRecordText(server.headers)
  };
}

export function toSettingsMcpFormState(
  payload: UserSettingsMcpPayload | null
): SettingsMcpFormState {
  return {
    workingDirectory: payload?.workingDirectory ?? "",
    configPath: payload?.configPath ?? "",
    foundConfig: payload?.foundConfig ?? false,
    diagnostics: payload?.diagnostics ?? [],
    servers: (payload?.servers ?? []).map((server, index) =>
      formatMcpServerFormState(server, payload?.serverStatuses ?? [], index)
    )
  };
}

export function toSettingsSkillsState(
  payload: UserSettingsSkillsPayload | null
): SettingsSkillsState {
  return {
    workingDirectory: payload?.workingDirectory ?? "",
    skills: payload?.skills ?? [],
    diagnostics: payload?.diagnostics ?? []
  };
}

export function createEmptyMcpServerFormState(
  transport: "stdio" | "http" = "stdio"
): SettingsMcpServerFormState {
  return {
    id: crypto.randomUUID(),
    name: "",
    transport,
    enabled: true,
    disabledTools: [],
    status: "unknown",
    tools: [],
    error: null,
    command: "",
    args: "",
    env: "",
    url: "",
    headers: ""
  };
}

function splitMcpLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseMcpRecordText(value: string): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of splitMcpLines(value)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`MCP key-value line must use KEY=value: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      throw new Error(`MCP key-value line is missing a key: ${line}`);
    }
    record[key] = line.slice(separatorIndex + 1).trim();
  }
  return record;
}

export function buildMcpServersFromForm(
  form: SettingsMcpFormState
): WorkspaceMcpServerConfig[] {
  const servers: WorkspaceMcpServerConfig[] = [];

  for (const server of form.servers) {
    const name = server.name.trim();
    if (!name) {
      throw new Error("MCP server name is required.");
    }

    if (server.transport === "stdio") {
      const command = server.command.trim();
      if (!command) {
        throw new Error(`MCP stdio server ${name} requires a command.`);
      }
      servers.push(
        normalizeWorkspaceMcpServerConfig({
          name: server.name,
          transport: "stdio",
          enabled: server.enabled,
          disabledTools: server.disabledTools,
          command: server.command,
          args: splitMcpLines(server.args),
          env: parseMcpRecordText(server.env)
        })
      );
      continue;
    }

    const url = server.url.trim();
    if (!url) {
      throw new Error(`MCP HTTP server ${name} requires a URL.`);
    }
    servers.push(
      normalizeWorkspaceMcpServerConfig({
        name,
        transport: "http",
        enabled: server.enabled,
        disabledTools: server.disabledTools,
        url: server.url,
        headers: parseMcpRecordText(server.headers)
      })
    );
  }

  const duplicateNames = findDuplicateWorkspaceMcpServerNames(servers);
  if (duplicateNames.length > 0) {
    throw new Error(`MCP server name is duplicated: ${duplicateNames[0]}`);
  }

  return servers;
}

export function buildSessionSettingsPatchFromUserSettings(
  settings: SessionSettingsRecord
): UpdateSessionSettingsPayload {
  return {
    yoloMode: settings.yoloMode,
    thinkingEffort: settings.thinkingEffort,
    shellAllowPatterns: settings.shellAllowPatterns,
    shellDenyPatterns: settings.shellDenyPatterns,
    toolAllowList: settings.toolAllowList,
    toolAskList: settings.toolAskList,
    toolDenyList: settings.toolDenyList,
    enabledCapabilityPacks: settings.enabledCapabilityPacks
  };
}

export function buildUserSettingsPayloadFromForm(
  form: SettingsFormState
): UpdateUserSettingsPayload {
  const normalizedForm = normalizeSettingsFormState(form);

  return {
    workingDirectory: normalizedForm.workingDirectory,
    model: normalizedForm.model,
    thinkingEffort: normalizedForm.thinkingEffort === "max" ? "max" : "high",
    yoloMode: normalizedForm.yoloMode,
    contextWindow: normalizeContextWindow(normalizedForm.contextWindow),
    maxTurns: normalizeMaxTurns(normalizedForm.maxTurns),
    shellAllowPatterns: splitPatternLines(normalizedForm.shellAllowPatterns),
    shellDenyPatterns: splitPatternLines(normalizedForm.shellDenyPatterns),
    toolAllowList: normalizedForm.toolAllowList,
    toolAskList: normalizedForm.toolAskList,
    toolDenyList: normalizedForm.toolDenyList,
    enabledCapabilityPacks: normalizedForm.enabledCapabilityPacks,
    workspaceSkillSettings: normalizedForm.workspaceSkillSettings,
    userContextHooks: normalizedForm.userContextHooks,
    debugConversationView: normalizedForm.debugConversationView,
    userCustomPrompt: normalizedForm.userCustomPrompt
  };
}

function normalizeWorkspaceSkillSettings(
  settings: WorkspaceSkillSettingRecord[]
): WorkspaceSkillSettingRecord[] {
  const seenNames = new Set<string>();
  const normalized: WorkspaceSkillSettingRecord[] = [];

  for (const setting of settings) {
    const skillName = setting.skillName.trim();
    if (!skillName || seenNames.has(skillName)) {
      continue;
    }

    seenNames.add(skillName);
    normalized.push({
      skillName,
      enabled: setting.enabled
    });
  }

  return normalized;
}

export function resolveSelectedModelId(input: {
  session: SessionSnapshot | null;
  settingsForm: SettingsFormState;
}): string {
  return input.session?.model || input.settingsForm.model || "";
}

export function resolveSelectedThinkingEffort(input: {
  session: SessionSnapshot | null;
  settingsForm: SettingsFormState;
}): string {
  return (
    input.session?.context.thinkingEffort ||
    input.settingsForm.thinkingEffort ||
    "high"
  );
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

export function enforceSingleEnabledUserContextHookType<
  T extends UserContextHookRecord
>(hooks: T[], priorityHookId?: string): T[] {
  const priorityHook =
    typeof priorityHookId === "string"
      ? hooks.find((hook) => hook.id === priorityHookId)
      : undefined;
  const orderedHooks = priorityHook
    ? [priorityHook, ...hooks.filter((hook) => hook.id !== priorityHook.id)]
    : hooks;
  const enabledTypeKeys = new Set<string>();
  const enabledHookIds = new Set<string>();

  for (const hook of orderedHooks) {
    if (!hook.enabled) {
      continue;
    }

    const typeKey = getUserContextHookTypeKey(hook);
    if (enabledTypeKeys.has(typeKey)) {
      continue;
    }

    enabledTypeKeys.add(typeKey);
    enabledHookIds.add(hook.id);
  }

  return hooks.map((hook) =>
    hook.enabled && !enabledHookIds.has(hook.id)
      ? { ...hook, enabled: false }
      : hook
  );
}

export function getNextAvailableUserContextHookType(
  hooks: UserContextHookRecord[]
): {
  behavior: NonNullable<UserContextHookRecord["behavior"]>;
  event: UserContextHookRecord["event"];
} | null {
  const enabledTypeKeys = new Set(
    hooks
      .filter((hook) => hook.enabled)
      .map((hook) => getUserContextHookTypeKey(hook))
  );

  return (
    USER_CONTEXT_HOOK_TYPES.find(
      (hookType) => !enabledTypeKeys.has(getUserContextHookTypeKey(hookType))
    ) ?? null
  );
}

export function normalizeSettingsFormState(
  form: SettingsFormState
): SettingsFormState {
  return {
    workingDirectory: form.workingDirectory.trim(),
    model: form.model.trim(),
    thinkingEffort: form.thinkingEffort === "max" ? "max" : "high",
    yoloMode: form.yoloMode,
    contextWindow: String(normalizeContextWindow(form.contextWindow)),
    maxTurns: String(normalizeMaxTurns(form.maxTurns)),
    shellAllowPatterns: normalizePatternText(form.shellAllowPatterns),
    shellDenyPatterns: normalizePatternText(form.shellDenyPatterns),
    toolAllowList: normalizeList(form.toolAllowList),
    toolAskList: normalizeList(form.toolAskList),
    toolDenyList: normalizeList(form.toolDenyList),
    enabledCapabilityPacks: normalizeList(form.enabledCapabilityPacks),
    workspaceSkillSettings: normalizeWorkspaceSkillSettings(
      form.workspaceSkillSettings
    ),
    userContextHooks: enforceSingleEnabledUserContextHookType(
      form.userContextHooks
        .flatMap((hook) => {
          const behavior =
            hook.behavior ?? (hook.event === "run_end" ? "message" : "context");
          const normalizedHook = {
            ...hook,
            behavior,
            event:
              (behavior === "context" || behavior === "subagent") &&
              hook.event === "run_end"
                ? "run_started"
                : hook.event,
            id: hook.id.trim(),
            title: hook.title.trim(),
            content: hook.content.trim()
          };
          return [
            behavior === "subagent"
              ? {
                  ...normalizedHook,
                  waitMode: hook.waitMode ?? "blocking",
                  maxTurns: normalizeMaxTurns(
                    String(hook.maxTurns ?? DEFAULT_MAX_TURNS)
                  )
                }
              : normalizedHook
          ];
        })
        .filter((hook) => hook.id.length > 0 && hook.content.length > 0)
    ),
    debugConversationView: form.debugConversationView,
    userCustomPrompt: form.userCustomPrompt.trim()
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

export function appendPatternLine(
  currentPatterns: string,
  nextPattern: string
): string {
  const normalizedPattern = nextPattern.trim();
  const patterns = splitPatternLines(currentPatterns);
  if (!normalizedPattern || patterns.includes(normalizedPattern)) {
    return patterns.join("\n");
  }

  return [...patterns, normalizedPattern].join("\n");
}

export function removePatternLine(
  currentPatterns: string,
  targetPattern: string
): string {
  const normalizedTarget = targetPattern.trim();
  return splitPatternLines(currentPatterns)
    .filter((pattern) => pattern !== normalizedTarget)
    .join("\n");
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
