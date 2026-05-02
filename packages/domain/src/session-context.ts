import type { DomainJsonValue } from "./json.js";
import type { CapabilityPackName } from "./session-settings.js";
import type { PermissionRuleLists } from "./permission-rules.js";
import type {
  BackgroundTaskKind,
  BackgroundTaskResultEnvelope,
  DelegateExpectedParentReply,
  DelegateRequestEnvelope,
  DelegateRequestKind
} from "./background-task.js";
import type {
  UserContextHookEvent,
  UserContextHookWaitMode
} from "./user-context-hooks.js";

export type ScheduleSessionStatus =
  | "running"
  | "waiting_for_permission"
  | "waiting_for_conflict_confirmation"
  | "waiting_for_user_question"
  | "waiting_for_user_input"
  | "completed"
  | "failed";

export type SessionToolFamily =
  | "workspace-file"
  | "workspace-shell"
  | "workspace-network"
  | "mcp"
  | "delegation"
  | "planning"
  | "schedule"
  | "lsp";

export type SessionPermissionProfile =
  | "allow"
  | "destructive-only"
  | "always-ask-user";

export interface PendingConfirmationItem {
  previewText: string;
  toolName?: string;
  toolInput?: Record<string, DomainJsonValue>;
}

export interface PendingConflictItem {
  routineId: string;
  previewText: string;
}

export interface PendingConfirmationPayload {
  summaryText: string;
  proposedItems: PendingConfirmationItem[];
  contextNote?: string;
  conflictItems?: PendingConflictItem[];
  createdAt: string;
}

export interface ConfirmationToolProposedItemInput {
  preview_text: string;
  tool_name?: string | undefined;
  tool_input?: Record<string, DomainJsonValue> | undefined;
}

export interface ConfirmationToolConflictItemInput {
  routine_id: string;
  preview_text: string;
}

export interface ConfirmationToolPayloadInput {
  summary_text: string;
  proposed_items: ConfirmationToolProposedItemInput[];
  context_note?: string | undefined;
  conflict_items?: ConfirmationToolConflictItemInput[] | undefined;
}

export interface PendingUserQuestionOption {
  label: string;
  reply: string;
  description?: string;
  isRecommended?: boolean;
}

export interface PendingUserQuestionItem {
  questionText: string;
  options: PendingUserQuestionOption[];
  allowCancel?: boolean;
}

export interface PendingUserQuestionPayload {
  questions: PendingUserQuestionItem[];
  createdAt: string;
}

export interface UserQuestionToolOptionInput {
  label: string;
  reply: string;
  description?: string | undefined;
  is_recommended?: boolean | undefined;
}

export interface UserQuestionToolQuestionInput {
  question_text: string;
  options?: UserQuestionToolOptionInput[] | undefined;
  allow_cancel?: boolean | undefined;
  context_note?: string | undefined;
}

export interface UserQuestionToolPayloadInput {
  questions: UserQuestionToolQuestionInput[];
  createdAt?: string | undefined;
}

export const PENDING_USER_QUESTION_CONTEXT_OPTION_LABEL = "补充说明";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePendingUserQuestionOption(
  value: unknown
): PendingUserQuestionOption | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const label =
    typeof value.label === "string" ? value.label.trim() : undefined;
  const reply =
    typeof value.reply === "string" ? value.reply.trim() : undefined;
  if (!label || !reply) {
    return null;
  }

  return {
    label,
    reply,
    ...(typeof value.description === "string" && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
    ...(value.isRecommended === true ? { isRecommended: true } : {})
  };
}

export function createPendingUserQuestionContextOption(
  contextNote: string
): PendingUserQuestionOption {
  const normalizedContextNote = contextNote.trim();
  return {
    label: PENDING_USER_QUESTION_CONTEXT_OPTION_LABEL,
    reply: normalizedContextNote,
    description: normalizedContextNote
  };
}

export function appendPendingUserQuestionContextOption(
  options: PendingUserQuestionOption[],
  contextNote: string | null | undefined
): PendingUserQuestionOption[] {
  const normalizedContextNote =
    typeof contextNote === "string" ? contextNote.trim() : "";
  if (!normalizedContextNote) {
    return options;
  }

  if (options.some((option) => option.reply === normalizedContextNote)) {
    return options;
  }

  return [
    ...options,
    createPendingUserQuestionContextOption(normalizedContextNote)
  ];
}

function createPendingUserQuestionOption(
  option: UserQuestionToolOptionInput
): PendingUserQuestionOption {
  return {
    label: option.label,
    reply: option.reply,
    ...(option.description ? { description: option.description } : {}),
    ...(option.is_recommended ? { isRecommended: true } : {})
  };
}

export function createPendingUserQuestionPayload(
  input: UserQuestionToolPayloadInput
): PendingUserQuestionPayload {
  return {
    questions: input.questions.map((question) => ({
      questionText: question.question_text,
      options: appendPendingUserQuestionContextOption(
        (question.options ?? []).map(createPendingUserQuestionOption),
        question.context_note
      ),
      allowCancel: question.allow_cancel !== false
    })),
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}

export function createUserQuestionToolResultData(
  questions: UserQuestionToolQuestionInput[]
): Record<string, DomainJsonValue> {
  return {
    questions: questions.map((question) => ({
      question_text: question.question_text,
      options: (question.options ?? []).map((option) => {
        const next: Record<string, DomainJsonValue> = {
          label: option.label,
          reply: option.reply
        };
        if (option.description) {
          next.description = option.description;
        }
        if (option.is_recommended) {
          next.is_recommended = true;
        }
        return next;
      }),
      allow_cancel: question.allow_cancel !== false,
      context_note: question.context_note ?? null
    }))
  };
}

export function createPendingUserQuestionDelegateRequest(
  payload: PendingUserQuestionPayload
): DelegateRequestEnvelope {
  const summary =
    payload.questions.length === 1
      ? (payload.questions[0]?.questionText ?? "Need more input.")
      : `需要补充回答 ${payload.questions.length} 个问题`;

  return {
    kind: "user_question",
    summary,
    data: {
      questions: payload.questions.map((question) => ({
        questionText: question.questionText,
        options: question.options.map((option) => ({
          label: option.label,
          reply: option.reply,
          ...(option.description ? { description: option.description } : {}),
          ...(option.isRecommended ? { isRecommended: true } : {})
        })),
        allowCancel: question.allowCancel !== false
      }))
    }
  };
}

export function createPendingConfirmationPayload(
  input: ConfirmationToolPayloadInput,
  createdAt = new Date().toISOString()
): PendingConfirmationPayload {
  return {
    summaryText: input.summary_text,
    proposedItems: input.proposed_items.map((item) => ({
      previewText: item.preview_text,
      ...(typeof item.tool_name === "string"
        ? { toolName: item.tool_name }
        : {}),
      ...(item.tool_input ? { toolInput: item.tool_input } : {})
    })),
    ...(typeof input.context_note === "string"
      ? { contextNote: input.context_note }
      : {}),
    ...(input.conflict_items
      ? {
          conflictItems: input.conflict_items.map((item) => ({
            routineId: item.routine_id,
            previewText: item.preview_text
          }))
        }
      : {}),
    createdAt
  };
}

export function createConfirmationToolResultData(
  payload: PendingConfirmationPayload
): Record<string, DomainJsonValue> {
  return {
    summary_text: payload.summaryText,
    proposed_items: payload.proposedItems.map((item) => {
      const next: Record<string, DomainJsonValue> = {
        preview_text: item.previewText
      };
      if (item.toolName) {
        next.tool_name = item.toolName;
      }
      if (item.toolInput) {
        next.tool_input = item.toolInput;
      }
      return next;
    }),
    conflict_items: (payload.conflictItems ?? []).map((item) => ({
      routine_id: item.routineId,
      preview_text: item.previewText
    })),
    context_note: payload.contextNote ?? null
  };
}

export function createPendingConfirmationDelegateRequest(
  payload: PendingConfirmationPayload
): DelegateRequestEnvelope {
  return {
    kind: "confirmation_request",
    summary: payload.summaryText,
    data: {
      summaryText: payload.summaryText,
      proposedItems: payload.proposedItems.map((item) => ({
        previewText: item.previewText,
        ...(item.toolName ? { toolName: item.toolName } : {}),
        ...(item.toolInput ? { toolInput: item.toolInput } : {})
      })),
      conflictItems: (payload.conflictItems ?? []).map((item) => ({
        routineId: item.routineId,
        previewText: item.previewText
      })),
      ...(payload.contextNote ? { contextNote: payload.contextNote } : {})
    }
  };
}

function normalizePendingUserQuestionItem(
  value: unknown
): PendingUserQuestionItem | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const questionText =
    typeof value.questionText === "string" ? value.questionText.trim() : "";
  if (!questionText) {
    return null;
  }

  const normalizedOptions = Array.isArray(value.options)
    ? value.options
        .map((option) => normalizePendingUserQuestionOption(option))
        .filter(
          (option): option is PendingUserQuestionOption => option !== null
        )
    : [];

  const options = appendPendingUserQuestionContextOption(
    normalizedOptions,
    typeof value.contextNote === "string" ? value.contextNote : null
  );

  return {
    questionText,
    options,
    ...(typeof value.allowCancel === "boolean"
      ? { allowCancel: value.allowCancel }
      : {})
  };
}

export function normalizePendingUserQuestionPayload(
  value: unknown
): PendingUserQuestionPayload | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const createdAt =
    typeof value.createdAt === "string" ? value.createdAt.trim() : "";
  if (!createdAt) {
    return null;
  }

  const questions = Array.isArray(value.questions)
    ? value.questions
        .map((item) => normalizePendingUserQuestionItem(item))
        .filter((item): item is PendingUserQuestionItem => item !== null)
    : (() => {
        const legacyItem = normalizePendingUserQuestionItem(value);
        return legacyItem ? [legacyItem] : [];
      })();

  if (questions.length === 0) {
    return null;
  }

  return {
    questions,
    createdAt
  };
}

export interface PendingPermissionRequest {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, DomainJsonValue>;
  responseGroupId?: string;
  family: SessionToolFamily;
  permissionProfile: SessionPermissionProfile;
  summaryText: string;
  contextNote?: string;
  allowWorkspaceEscape?: boolean;
  createdAt: string;
}

export type BackgroundNotificationKind =
  | "task_completed"
  | "task_waiting"
  | "task_failed"
  | "task_cancelled"
  | "task_timeout";

export interface BackgroundNotificationRequest {
  kind: DelegateRequestKind;
  summary: string;
  data: Record<string, DomainJsonValue>;
}

export interface SessionBackgroundNotification {
  id: string;
  kind: BackgroundNotificationKind;
  taskId: string;
  taskKind: BackgroundTaskKind;
  childSessionId?: string | null;
  title: string;
  summary: string;
  content: string;
  createdAt: string;
  requiresMainAgentReply: boolean;
  expectedParentReply: DelegateExpectedParentReply;
  request?: BackgroundNotificationRequest | null;
  result?: BackgroundTaskResultEnvelope | null;
  consumedAt?: string | null;
}

export interface HookContextEntry {
  hookId: string;
  hookEvent: UserContextHookEvent;
  waitMode: UserContextHookWaitMode;
  taskId: string;
  title: string;
  configHash: string;
  content: string;
  createdAt: string;
}

export type TodoItemStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface SessionTodoItem {
  id: string;
  content: string;
  status: TodoItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTodoState {
  items: SessionTodoItem[];
  activeItemId: string | null;
  lastUpdatedAt: string | null;
}

export interface SessionFullCompactionState {
  summaryMarkdown: string;
  compactedAt: string;
  promptVersion: string;
  sourceBlockCount: number;
  retainedTailCount: number;
}

export const THINKING_EFFORT_OPTIONS = ["high", "max"] as const;
export type ThinkingEffort = (typeof THINKING_EFFORT_OPTIONS)[number];
export const DEFAULT_THINKING_EFFORT: ThinkingEffort = "high";

export function normalizeThinkingEffort(value: unknown): ThinkingEffort {
  return value === "max" ? "max" : DEFAULT_THINKING_EFFORT;
}

export interface ScheduleSessionContext {
  userId: string;
  status: ScheduleSessionStatus;
  currentDateContext: string;
  yoloMode: boolean;
  planModeEnabled: boolean;
  thinkingEffort?: ThinkingEffort;
  taskBriefPath: string | null;
  workspaceEscapeAllowed: boolean;
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  enabledCapabilityPacks: CapabilityPackName[];
  activeBackgroundTaskCount: number;
  pendingPermissionRequest: PendingPermissionRequest | null;
  pendingConfirmationPayload: PendingConfirmationPayload | null;
  pendingUserQuestionPayload: PendingUserQuestionPayload | null;
  pendingBackgroundNotifications: SessionBackgroundNotification[];
  hookContextEntries: HookContextEntry[];
  todoState?: SessionTodoState | null;
  fullCompactionState?: SessionFullCompactionState | null;
  pendingConflictSummary: string | null;
  firstUserMessage: string | null;
  lastUserMessage: string | null;
}

export type SessionPermissionRuleLists = PermissionRuleLists;
