import type {
  BackgroundTaskState,
  BackgroundTaskClaim,
  BackgroundTaskPayload,
  BackgroundTaskRecord,
  BackgroundTaskRunRecord,
  BackgroundTaskStatus
} from "@ai-app-template/domain";

import { backgroundTaskRuns, backgroundTasks } from "./schema.js";
import { toIsoString } from "./row-utils.js";

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

function cloneTaskState(
  value: BackgroundTaskState | null | undefined
): BackgroundTaskState | null {
  return structuredClone(value ?? null) as BackgroundTaskState | null;
}

function resolveStringOrNullPatch(
  value: string | null | undefined,
  fallback: string | null
): string | null {
  return typeof value === "string" || value === null ? value : fallback;
}

function resolveClaimTaskState(input: {
  task: BackgroundTaskRecord;
  taskState?: BackgroundTaskState | null | undefined;
}): BackgroundTaskState | null {
  return cloneTaskState(input.taskState ?? input.task.taskState ?? null);
}

function resolveClaimTaskResultSummary(input: {
  task: BackgroundTaskRecord;
  resultSummary?: string | null | undefined;
  taskState?: BackgroundTaskState | null | undefined;
}): string | null {
  const taskState = input.taskState ?? input.task.taskState ?? null;
  return resolveTaskResultSummary({
    taskState,
    fallback: input.resultSummary ?? input.task.resultSummary
  });
}

function resolveClaimRunResultSummary(input: {
  task: BackgroundTaskRecord;
  run: BackgroundTaskRunRecord;
  resultSummary?: string | null | undefined;
  taskState?: BackgroundTaskState | null | undefined;
}): string | null {
  const taskState = input.taskState ?? input.task.taskState ?? null;
  return resolveTaskResultSummary({
    taskState,
    fallback: input.resultSummary ?? input.run.resultSummary
  });
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

export function buildClaimedTaskAndRun(input: {
  task: BackgroundTaskRecord;
  runId: string;
  workerId: string;
  now: string;
}): BackgroundTaskClaim {
  const claimedTask: BackgroundTaskRecord = {
    ...input.task,
    status: "claimed",
    activeRunId: input.runId,
    attemptCount: input.task.attemptCount + 1,
    claimedBy: input.workerId,
    claimedAt: input.now,
    lastHeartbeatAt: input.now,
    availableAt: null,
    updatedAt: input.now
  };
  const run: BackgroundTaskRunRecord = {
    runId: input.runId,
    taskId: claimedTask.taskId,
    status: "claimed",
    workerId: input.workerId,
    errorSummary: null,
    resultSummary: null,
    startedAt: input.now,
    finishedAt: null,
    lastHeartbeatAt: input.now,
    createdAt: input.now,
    updatedAt: input.now
  };
  return { task: claimedTask, run };
}

export function buildHeartbeatTaskClaim(input: {
  claim: BackgroundTaskClaim;
  now: string;
}): BackgroundTaskClaim {
  requireActiveTaskStatus(
    input.claim.task,
    ["claimed", "running", "cancelling"],
    "heartbeat"
  );
  return {
    task: {
      ...input.claim.task,
      lastHeartbeatAt: input.now,
      updatedAt: input.now
    },
    run: {
      ...input.claim.run,
      lastHeartbeatAt: input.now,
      updatedAt: input.now
    }
  };
}

export function buildRunningTaskClaim(input: {
  claim: BackgroundTaskClaim;
  workerId: string;
  now: string;
}): BackgroundTaskClaim {
  requireActiveTaskStatus(input.claim.task, ["claimed"], "mark running");
  return {
    task: {
      ...input.claim.task,
      status: "running",
      claimedBy: input.workerId,
      lastHeartbeatAt: input.now,
      updatedAt: input.now
    },
    run: {
      ...input.claim.run,
      status: "running",
      workerId: input.workerId,
      lastHeartbeatAt: input.now,
      updatedAt: input.now
    }
  };
}

export function buildWaitingTaskClaim(
  claim: BackgroundTaskClaim,
  input: TaskWaitingForInputInput | TaskWaitingForMainAgentInput,
  now: string,
  status: Extract<
    BackgroundTaskStatus,
    "waiting_for_input" | "waiting_for_main_agent"
  >
): BackgroundTaskClaim {
  requireActiveTaskStatus(
    claim.task,
    ["claimed", "running", "cancelling"],
    status === "waiting_for_input"
      ? "mark waiting for input"
      : "mark waiting for main agent"
  );
  return {
    task: finishTaskClaim(
      {
        ...claim.task,
        status,
        taskState: resolveClaimTaskState({
          task: claim.task,
          taskState: input.taskState
        }),
        resultSummary: resolveClaimTaskResultSummary({
          task: claim.task,
          resultSummary: input.resultSummary,
          taskState: input.taskState
        })
      },
      now
    ),
    run: finishRun(claim.run, status, now, {
      resultSummary: resolveClaimRunResultSummary({
        task: claim.task,
        run: claim.run,
        resultSummary: input.resultSummary,
        taskState: input.taskState
      })
    })
  };
}

export function buildFinishedTaskClaim(
  claim: BackgroundTaskClaim,
  input: CompleteTaskInput | FailTaskInput | CancelTaskInput,
  now: string,
  status: Extract<BackgroundTaskStatus, "completed" | "failed" | "cancelled">
): BackgroundTaskClaim {
  requireActiveTaskStatus(
    claim.task,
    ["claimed", "running", "cancelling"],
    status === "completed"
      ? "complete"
      : status === "failed"
        ? "fail"
        : "cancel"
  );
  const errorSummary =
    status === "failed" && "errorSummary" in input ? input.errorSummary : null;
  const task = finishTaskClaim(
    {
      ...claim.task,
      status,
      taskState: resolveClaimTaskState({
        task: claim.task,
        taskState: input.taskState
      }),
      lastError: errorSummary ?? claim.task.lastError,
      resultSummary: resolveClaimTaskResultSummary({
        task: claim.task,
        resultSummary: input.resultSummary,
        taskState: input.taskState
      }),
      completedAt: now
    },
    now
  );
  return {
    task: {
      ...task,
      completedAt: now
    },
    run: finishRun(claim.run, status, now, {
      errorSummary,
      resultSummary: resolveClaimRunResultSummary({
        task: claim.task,
        run: claim.run,
        resultSummary: input.resultSummary,
        taskState: input.taskState
      })
    })
  };
}

export function buildCancelRequestTask(
  task: BackgroundTaskRecord,
  now: string
): BackgroundTaskRecord {
  if (
    task.status === "cancelled" ||
    task.status === "completed" ||
    task.status === "failed"
  ) {
    return cloneTask(task);
  }

  if (task.status === "queued") {
    return {
      ...task,
      status: "cancelled",
      cancelRequested: false,
      completedAt: now,
      updatedAt: now
    };
  }

  return {
    ...task,
    status: "cancelling",
    cancelRequested: true,
    updatedAt: now
  };
}

export function buildRescheduledQueuedTask(
  task: BackgroundTaskRecord,
  input: RescheduleQueuedTaskInput,
  now: string
): BackgroundTaskRecord {
  requireActiveTaskStatus(task, ["queued"], "reschedule queued");
  return {
    ...task,
    payload: structuredClone(
      input.payload ?? task.payload
    ) as BackgroundTaskPayload,
    resultSummary: resolveStringOrNullPatch(
      input.resultSummary,
      task.resultSummary
    ),
    lastError: resolveStringOrNullPatch(input.lastError, task.lastError),
    availableAt: resolveStringOrNullPatch(input.availableAt, task.availableAt),
    deadlineAt: resolveStringOrNullPatch(input.deadlineAt, task.deadlineAt),
    updatedAt: now
  };
}

export function buildRequeuedTask(
  task: BackgroundTaskRecord,
  input: RequeueExistingTaskInput,
  now: string
): BackgroundTaskRecord {
  if (
    task.status === "queued" ||
    task.status === "claimed" ||
    task.status === "running" ||
    task.status === "cancelling"
  ) {
    throw new Error(`Task ${task.taskId} is already active.`);
  }

  const taskState = input.taskState ?? task.taskState ?? null;
  return {
    ...task,
    status: "queued",
    payload: structuredClone(
      input.payload ?? task.payload
    ) as BackgroundTaskPayload,
    taskState: cloneTaskState(taskState),
    resultSummary: resolveTaskResultSummary({
      taskState,
      fallback: input.resultSummary ?? task.resultSummary
    }),
    lastError: resolveStringOrNullPatch(input.lastError, task.lastError),
    availableAt: resolveStringOrNullPatch(input.availableAt, null),
    deadlineAt: resolveStringOrNullPatch(input.deadlineAt, task.deadlineAt),
    attemptCount: 0,
    maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? task.maxAttempts)),
    cancelRequested: false,
    activeRunId: null,
    claimedBy: null,
    claimedAt: null,
    lastHeartbeatAt: null,
    completedAt: null,
    updatedAt: now
  };
}

export function buildStaleClaimTransition(input: {
  task: BackgroundTaskRecord;
  run?: BackgroundTaskRunRecord | null | undefined;
  now: string;
  errorSummary?: string;
}): {
  task: BackgroundTaskRecord;
  run: BackgroundTaskRunRecord | null;
} {
  const errorSummary =
    input.errorSummary ?? "Worker claim expired before completion.";
  const shouldRetry = input.task.attemptCount < input.task.maxAttempts;
  return {
    task: {
      ...input.task,
      status: shouldRetry ? "queued" : "failed",
      cancelRequested: false,
      activeRunId: null,
      claimedBy: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      lastError: shouldRetry ? input.task.lastError : errorSummary,
      completedAt: shouldRetry ? null : input.now,
      updatedAt: input.now
    },
    run: input.run
      ? finishRun(input.run, "failed", input.now, {
          errorSummary
        })
      : null
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
