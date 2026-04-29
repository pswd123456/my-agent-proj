import type { DomainJsonValue } from "./json.js";
import type { CapabilityPackName } from "./session-settings.js";
import type { PermissionRuleLists } from "./permission-rules.js";
import type {
  BackgroundTaskKind,
  BackgroundTaskResultEnvelope,
  DelegateExpectedParentReply,
  DelegateRequestKind
} from "./background-task.js";

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
  | "schedule";

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

export interface PendingUserQuestionOption {
  label: string;
  reply: string;
  description?: string;
  isRecommended?: boolean;
}

export interface PendingUserQuestionPayload {
  questionText: string;
  options: PendingUserQuestionOption[];
  allowCancel?: boolean;
  contextNote?: string;
  createdAt: string;
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
  todoState?: SessionTodoState | null;
  fullCompactionState?: SessionFullCompactionState | null;
  pendingConflictSummary: string | null;
  firstUserMessage: string | null;
  lastUserMessage: string | null;
}

export type SessionPermissionRuleLists = PermissionRuleLists;
