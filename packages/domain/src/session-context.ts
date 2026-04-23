import type { DomainJsonValue } from "./json.js";
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

export interface ScheduleSessionContext {
  userId: string;
  status: ScheduleSessionStatus;
  currentDateContext: string;
  yoloMode: boolean;
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  pendingPermissionRequest: PendingPermissionRequest | null;
  pendingConfirmationPayload: PendingConfirmationPayload | null;
  pendingConflictSummary: string | null;
  lastUserMessage: string | null;
}

export type SessionPermissionRuleLists = PermissionRuleLists;
