import type { CapabilityPackName } from "./session-settings.js";
import type { DomainJsonValue } from "./json.js";
import type {
  UserContextHookEvent,
  UserContextHookWaitMode
} from "./user-context-hooks.js";

export const BACKGROUND_TASK_KIND_OPTIONS = [
  "cron_job",
  "subagent",
  "hook_subagent",
  "session_wakeup",
  "shell_command",
  "memory_summary"
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

export const BACKGROUND_TASK_EXECUTOR_OPTIONS = [
  "agent_session",
  "shell_command",
  "memory_summary"
] as const;
export type BackgroundTaskExecutor =
  (typeof BACKGROUND_TASK_EXECUTOR_OPTIONS)[number];

export const BACKGROUND_TASK_WAIT_MODE_OPTIONS = [
  "blocking",
  "unblocking"
] as const;
export type BackgroundTaskWaitMode =
  (typeof BACKGROUND_TASK_WAIT_MODE_OPTIONS)[number];

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

export interface DelegateTaskState {
  kind: "delegate";
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

export interface ShellCommandResultEnvelope {
  type: "shell_command";
  command: string;
  stdout: string;
  stderr: string;
  workingDirectory: string;
  timeoutMs: number;
  exitCode: number | null;
  terminationReason:
    | "completed"
    | "failed"
    | "timeout"
    | "cancelled"
    | "interrupted";
}

export interface ShellCommandTaskState {
  kind: "shell_command";
  command: string;
  waitMode: BackgroundTaskWaitMode;
  timeoutMs: number;
  latestResult: ShellCommandResultEnvelope | null;
}

export interface MemorySummaryTaskState {
  kind: "memory_summary";
  sourceSessionId: string;
  stageKey: string;
  latestResult: MemorySummaryResultEnvelope | null;
}

export interface HookSubagentBackgroundTaskResultEnvelope {
  type: "hook_subagent";
  hookId: string;
  hookEvent: UserContextHookEvent;
  waitMode: UserContextHookWaitMode;
  title: string;
  configHash: string;
  content: string;
}

export interface HookSubagentTaskState {
  kind: "hook_subagent";
  hookId: string;
  hookEvent: UserContextHookEvent;
  waitMode: UserContextHookWaitMode;
  title: string;
  configHash: string;
  latestResult: HookSubagentBackgroundTaskResultEnvelope | null;
}

export type BackgroundTaskState =
  | DelegateTaskState
  | ShellCommandTaskState
  | HookSubagentTaskState
  | MemorySummaryTaskState;

export type DelegatePermissionDecision = "approve" | "reject";

export interface AgentSessionBackgroundTaskPayload {
  executor: "agent_session";
  message: string;
  workingDirectory: string;
  model: string;
  maxTurns: number;
  permissionReply?: boolean;
  enabledCapabilityPacks: CapabilityPackName[];
  metadata: Record<string, DomainJsonValue>;
}

export interface ShellCommandBackgroundTaskPayload {
  executor: "shell_command";
  message: string;
  workingDirectory: string;
  model: string;
  maxTurns: number;
  enabledCapabilityPacks: CapabilityPackName[];
  metadata: Record<string, DomainJsonValue>;
  command: string;
  timeoutMs: number;
}

export interface MemorySummaryBackgroundTaskPayload {
  executor: "memory_summary";
  message: string;
  workingDirectory: string;
  model: string;
  maxTurns: number;
  enabledCapabilityPacks: CapabilityPackName[];
  metadata: Record<string, DomainJsonValue>;
  sourceSessionId: string;
  stageKey: string;
  memoryDirectory?: string | null;
}

export type BackgroundTaskPayload =
  | AgentSessionBackgroundTaskPayload
  | ShellCommandBackgroundTaskPayload
  | MemorySummaryBackgroundTaskPayload;

export interface DelegateBackgroundTaskResultEnvelope {
  type: "delegate";
  summary: string;
  content: string;
  responseKind: DelegateResponseKind;
  expectedParentReply: DelegateExpectedParentReply;
  request?: DelegateRequestEnvelope | null;
}

export interface MemorySummaryResultEnvelope {
  type: "memory_summary";
  sourceSessionId: string;
  stageKey: string;
  memoryPath: string | null;
  outcome: "written" | "skipped";
  summary: string;
}

export type BackgroundTaskResultEnvelope =
  | DelegateBackgroundTaskResultEnvelope
  | ShellCommandResultEnvelope
  | HookSubagentBackgroundTaskResultEnvelope
  | MemorySummaryResultEnvelope;

export interface BackgroundTaskHandle {
  taskId: string;
  taskKind: BackgroundTaskKind;
  status: BackgroundTaskStatus;
  waitMode: BackgroundTaskWaitMode;
  initialCheckAfterMs: number;
}

export interface BackgroundTaskRecord {
  taskId: string;
  kind: BackgroundTaskKind;
  status: BackgroundTaskStatus;
  executor: BackgroundTaskExecutor;
  parentSessionId: string | null;
  childSessionId: string | null;
  payload: BackgroundTaskPayload;
  taskState: BackgroundTaskState | null;
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
