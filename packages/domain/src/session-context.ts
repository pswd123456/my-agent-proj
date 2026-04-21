import type { DomainJsonValue } from "./json.js";

export type ScheduleSessionStatus =
  | "running"
  | "waiting_for_conflict_confirmation"
  | "waiting_for_user_input"
  | "completed"
  | "failed";

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

export interface ScheduleSessionContext {
  userId: string;
  status: ScheduleSessionStatus;
  currentDateContext: string;
  pendingConfirmationPayload: PendingConfirmationPayload | null;
  pendingConflictSummary: string | null;
  lastUserMessage: string | null;
}
