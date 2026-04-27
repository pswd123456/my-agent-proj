import type { CapabilityPackName } from "./session-settings.js";
import type { DomainJsonValue } from "./json.js";

export const BACKGROUND_TASK_KIND_OPTIONS = [
  "cron_job",
  "subagent",
  "session_wakeup"
] as const;
export type BackgroundTaskKind =
  (typeof BACKGROUND_TASK_KIND_OPTIONS)[number];

export const BACKGROUND_TASK_STATUS_OPTIONS = [
  "queued",
  "claimed",
  "running",
  "waiting_for_input",
  "waiting_for_main_agent",
  "cancelling",
  "cancelled",
  "completed",
  "failed"
] as const;
export type BackgroundTaskStatus =
  (typeof BACKGROUND_TASK_STATUS_OPTIONS)[number];

export type BackgroundTaskExecutor = "agent_session";

export const DELEGATE_EXPECTED_PARENT_REPLY_OPTIONS = [
  "none",
  "message",
  "permission_decision"
] as const;
export type DelegateExpectedParentReply =
  (typeof DELEGATE_EXPECTED_PARENT_REPLY_OPTIONS)[number];

export const DELEGATE_RESPONSE_KIND_OPTIONS = [
  "message",
  "needs_main_agent",
  "failed",
  "cancelled"
] as const;
export type DelegateResponseKind =
  (typeof DELEGATE_RESPONSE_KIND_OPTIONS)[number];

export const DELEGATE_REQUEST_KIND_OPTIONS = [
  "user_question",
  "permission_request",
  "confirmation_request"
] as const;
export type DelegateRequestKind =
  (typeof DELEGATE_REQUEST_KIND_OPTIONS)[number];

export interface DelegateRequestEnvelope {
  kind: DelegateRequestKind;
  summary: string;
  data: Record<string, DomainJsonValue>;
}

export interface DelegateResponseEnvelope {
  kind: DelegateResponseKind;
  summary: string;
  content: string;
  request?: DelegateRequestEnvelope | null;
}

export interface DelegateTaskCard {
  title: string;
  objective: string;
  parentTaskSummary: string;
  acceptanceCriteria: string[];
  constraints: string[];
  currentRound: number;
  latestParentMessage: string | null;
  latestResponse: DelegateResponseEnvelope | null;
  expectedParentReply: DelegateExpectedParentReply;
  contextInheritance: "shell_only";
  responseIsolation: true;
}

export type DelegatePermissionDecision = "approve" | "reject";

export interface BackgroundTaskPayload {
  executor: BackgroundTaskExecutor;
  message: string;
  workingDirectory: string;
  model: string;
  maxTurns: number;
  permissionReply?: boolean;
  enabledCapabilityPacks: CapabilityPackName[];
  metadata: Record<string, DomainJsonValue>;
}

export interface BackgroundTaskRecord {
  taskId: string;
  kind: BackgroundTaskKind;
  status: BackgroundTaskStatus;
  executor: BackgroundTaskExecutor;
  parentSessionId: string | null;
  childSessionId: string;
  payload: BackgroundTaskPayload;
  taskCard: DelegateTaskCard | null;
  resultSummary: string | null;
  lastError: string | null;
  availableAt: string | null;
  deadlineAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  cancelRequested: boolean;
  activeRunId: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  lastHeartbeatAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundTaskRunRecord {
  runId: string;
  taskId: string;
  status: BackgroundTaskStatus;
  workerId: string | null;
  errorSummary: string | null;
  resultSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundTaskClaim {
  task: BackgroundTaskRecord;
  run: BackgroundTaskRunRecord;
}
