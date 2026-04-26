import type { DomainJsonValue } from "./json.js";
import type { CapabilityPackName } from "./session-settings.js";
import type { PermissionRuleLists } from "./permission-rules.js";

export type ScheduleSessionStatus =
  | "running"
  | "waiting_for_permission"
  | "waiting_for_conflict_confirmation"
  | "waiting_for_user_input"
  | "completed"
  | "failed";

export type SessionToolFamily =
  | "workspace-file"
  | "workspace-shell"
  | "workspace-network"
  | "mcp"
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

export interface PendingPermissionRequest {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, DomainJsonValue>;
  family: SessionToolFamily;
  permissionProfile: SessionPermissionProfile;
  summaryText: string;
  contextNote?: string;
  allowWorkspaceEscape?: boolean;
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

export interface ScheduleSessionContext {
  userId: string;
  status: ScheduleSessionStatus;
  currentDateContext: string;
  yoloMode: boolean;
  workspaceEscapeAllowed: boolean;
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  enabledCapabilityPacks: CapabilityPackName[];
  pendingPermissionRequest: PendingPermissionRequest | null;
  pendingConfirmationPayload: PendingConfirmationPayload | null;
  todoState?: SessionTodoState | null;
  pendingConflictSummary: string | null;
  lastUserMessage: string | null;
}

export type SessionPermissionRuleLists = PermissionRuleLists;
