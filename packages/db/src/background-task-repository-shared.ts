import type {
  BackgroundTaskState,
  BackgroundTaskClaim,
  BackgroundTaskPayload,
  BackgroundTaskRecord,
  BackgroundTaskRunRecord,
  BackgroundTaskStatus
} from "@ai-app-template/domain";

import { backgroundTaskRuns, backgroundTasks } from "./schema.js";

export type BackgroundTaskRow = typeof backgroundTasks.$inferSelect;
export type BackgroundTaskRunRow = typeof backgroundTaskRuns.$inferSelect;

export interface EnqueueBackgroundTaskInput {
  kind: BackgroundTaskRecord["kind"];
  parentSessionId?: string | null;
  childSessionId?: string | null;
  payload: BackgroundTaskPayload;
  taskState?: BackgroundTaskState | null;
  availableAt?: string | null;
  deadlineAt?: string | null;
  maxAttempts?: number;
}

export interface TaskClaimInput {
  taskId: string;
  runId: string;
  workerId: string;
}

export interface TaskWaitingForInputInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskState?: BackgroundTaskState | null;
}

export interface TaskWaitingForMainAgentInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskState?: BackgroundTaskState | null;
}

export interface CompleteTaskInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskState?: BackgroundTaskState | null;
}

export interface FailTaskInput extends TaskClaimInput {
  errorSummary: string;
  resultSummary?: string | null;
  taskState?: BackgroundTaskState | null;
}

export interface CancelTaskInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskState?: BackgroundTaskState | null;
}

export interface RequeueExistingTaskInput {
  taskId: string;
  payload?: BackgroundTaskPayload;
  taskState?: BackgroundTaskState | null;
  resultSummary?: string | null;
  lastError?: string | null;
  availableAt?: string | null;
  deadlineAt?: string | null;
  maxAttempts?: number;
}

export interface RescheduleQueuedTaskInput {
  taskId: string;
  payload?: BackgroundTaskPayload;
  resultSummary?: string | null;
  lastError?: string | null;
  availableAt?: string | null;
  deadlineAt?: string | null;
}

export interface BackgroundTaskRepository {
  getTask(taskId: string): Promise<BackgroundTaskRecord | null>;
  listTasks(): Promise<BackgroundTaskRecord[]>;
  getWakeupTaskBySessionId(
    sessionId: string
  ): Promise<BackgroundTaskRecord | null>;
  getRun(runId: string): Promise<BackgroundTaskRunRecord | null>;
  enqueueTask(input: EnqueueBackgroundTaskInput): Promise<BackgroundTaskRecord>;
  claimNextTask(workerId: string): Promise<BackgroundTaskClaim | null>;
  heartbeatTask(input: TaskClaimInput): Promise<BackgroundTaskClaim | null>;
  markTaskRunning(input: TaskClaimInput): Promise<BackgroundTaskClaim>;
  markTaskWaitingForInput(
    input: TaskWaitingForInputInput
  ): Promise<BackgroundTaskClaim>;
  markTaskWaitingForMainAgent(
    input: TaskWaitingForMainAgentInput
  ): Promise<BackgroundTaskClaim>;
  completeTask(input: CompleteTaskInput): Promise<BackgroundTaskClaim>;
  failTask(input: FailTaskInput): Promise<BackgroundTaskClaim>;
  requestCancel(taskId: string): Promise<BackgroundTaskRecord | null>;
  cancelTask(input: CancelTaskInput): Promise<BackgroundTaskClaim>;
  rescheduleQueuedTask(
    input: RescheduleQueuedTaskInput
  ): Promise<BackgroundTaskRecord>;
  requeueTask(input: RequeueExistingTaskInput): Promise<BackgroundTaskRecord>;
  requeueStaleClaims(staleBefore: string): Promise<BackgroundTaskRecord[]>;
}

export function toIsoString(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const tzMatch = normalized.match(/([+-]\d{2})(\d{2})?$/);
  const hasExplicitTimeZone =
    normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized) || tzMatch;
  const parsedValue = tzMatch
    ? normalized.replace(
        /([+-]\d{2})(\d{2})?$/,
        (_, hours: string, minutes?: string) => `${hours}:${minutes ?? "00"}`
      )
    : normalized;

  return new Date(
    hasExplicitTimeZone ? parsedValue : `${normalized}Z`
  ).toISOString();
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function normalizeTaskState(value: unknown): BackgroundTaskState | null {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if ("kind" in parsed && typeof parsed.kind === "string") {
    return parsed as BackgroundTaskState;
  }

  if (
    "title" in parsed &&
    typeof parsed.title === "string" &&
    "objective" in parsed &&
    typeof parsed.objective === "string"
  ) {
    return {
      kind: "delegate",
      ...(parsed as Omit<
        Extract<BackgroundTaskState, { kind: "delegate" }>,
        "kind"
      >)
    };
  }

  if ("command" in parsed && typeof parsed.command === "string") {
    return {
      kind: "shell_command",
      ...(parsed as Omit<
        Extract<BackgroundTaskState, { kind: "shell_command" }>,
        "kind"
      >)
    };
  }

  if (
    "hookId" in parsed &&
    typeof parsed.hookId === "string" &&
    "configHash" in parsed &&
    typeof parsed.configHash === "string"
  ) {
    return {
      kind: "hook_subagent",
      ...(parsed as Omit<
        Extract<BackgroundTaskState, { kind: "hook_subagent" }>,
        "kind"
      >)
    };
  }

  return null;
}

export function mapTaskRow(row: BackgroundTaskRow): BackgroundTaskRecord {
  return {
    taskId: row.id,
    kind: row.kind,
    status: row.status,
    executor: row.executor as BackgroundTaskRecord["executor"],
    parentSessionId: row.parentSessionId,
    childSessionId: row.childSessionId,
    payload: parseJsonValue(row.payload) as BackgroundTaskPayload,
    taskState: normalizeTaskState(row.taskState),
    resultSummary: row.resultSummary,
    lastError: row.lastError,
    availableAt: row.availableAt ? toIsoString(row.availableAt) : null,
    deadlineAt: row.deadlineAt ? toIsoString(row.deadlineAt) : null,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    cancelRequested: row.cancelRequested,
    activeRunId: row.activeRunId,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt ? toIsoString(row.claimedAt) : null,
    lastHeartbeatAt: row.lastHeartbeatAt
      ? toIsoString(row.lastHeartbeatAt)
      : null,
    completedAt: row.completedAt ? toIsoString(row.completedAt) : null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export function mapRunRow(row: BackgroundTaskRunRow): BackgroundTaskRunRecord {
  return {
    runId: row.runId,
    taskId: row.taskId,
    status: row.status,
    workerId: row.workerId,
    errorSummary: row.errorSummary,
    resultSummary: row.resultSummary,
    startedAt: toIsoString(row.startedAt),
    finishedAt: row.finishedAt ? toIsoString(row.finishedAt) : null,
    lastHeartbeatAt: row.lastHeartbeatAt
      ? toIsoString(row.lastHeartbeatAt)
      : null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export function buildClaim(
  task: BackgroundTaskRecord,
  run: BackgroundTaskRunRecord
): BackgroundTaskClaim {
  return {
    task: structuredClone(task) as BackgroundTaskRecord,
    run: structuredClone(run) as BackgroundTaskRunRecord
  };
}

export function requireActiveTaskStatus(
  task: BackgroundTaskRecord,
  allowed: BackgroundTaskStatus[],
  action: string
): void {
  if (!allowed.includes(task.status)) {
    throw new Error(
      `Cannot ${action} task ${task.taskId} while status is ${task.status}.`
    );
  }
}

export function cloneTask(task: BackgroundTaskRecord): BackgroundTaskRecord {
  return structuredClone(task) as BackgroundTaskRecord;
}

export function cloneRun(
  run: BackgroundTaskRunRecord
): BackgroundTaskRunRecord {
  return structuredClone(run) as BackgroundTaskRunRecord;
}

export function finishTaskClaim(
  task: BackgroundTaskRecord,
  now: string
): BackgroundTaskRecord {
  return {
    ...task,
    activeRunId: null,
    claimedBy: null,
    claimedAt: null,
    lastHeartbeatAt: null,
    cancelRequested: false,
    updatedAt: now
  };
}

export function finishRun(
  run: BackgroundTaskRunRecord,
  status: BackgroundTaskStatus,
  now: string,
  patch: {
    errorSummary?: string | null;
    resultSummary?: string | null;
  } = {}
): BackgroundTaskRunRecord {
  return {
    ...run,
    status,
    errorSummary:
      typeof patch.errorSummary === "string" || patch.errorSummary === null
        ? patch.errorSummary
        : run.errorSummary,
    resultSummary:
      typeof patch.resultSummary === "string" || patch.resultSummary === null
        ? patch.resultSummary
        : run.resultSummary,
    finishedAt: now,
    lastHeartbeatAt: now,
    updatedAt: now
  };
}

export function resolveTaskResultSummary(input: {
  taskState?: BackgroundTaskState | null | undefined;
  fallback?: string | null;
}): string | null {
  if (input.taskState?.kind === "delegate") {
    return input.taskState.latestResponse?.summary ?? input.fallback ?? null;
  }

  if (input.taskState?.kind === "shell_command") {
    const latestResult = input.taskState.latestResult;
    if (latestResult) {
      return `${latestResult.command} (${latestResult.terminationReason})`;
    }
  }

  if (input.taskState?.kind === "hook_subagent") {
    return input.taskState.latestResult?.title ?? input.fallback ?? null;
  }

  return input.fallback ?? null;
}

export function isTaskAvailable(
  task: BackgroundTaskRecord,
  now: string
): boolean {
  return !task.availableAt || task.availableAt <= now;
}

export function compareAvailableTasks(
  left: BackgroundTaskRecord,
  right: BackgroundTaskRecord
): number {
  const leftAvailableAt = left.availableAt ?? left.createdAt;
  const rightAvailableAt = right.availableAt ?? right.createdAt;
  const availableCompare = leftAvailableAt.localeCompare(rightAvailableAt);
  return availableCompare === 0
    ? left.createdAt.localeCompare(right.createdAt)
    : availableCompare;
}
