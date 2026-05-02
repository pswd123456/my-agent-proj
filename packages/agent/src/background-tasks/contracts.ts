import type {
  BackgroundTaskClaim,
  BackgroundTaskPayload,
  BackgroundTaskKind,
  BackgroundTaskRecord,
  BackgroundTaskState,
  BackgroundTaskExecutor,
  BackgroundTaskWaitMode,
  CapabilityPackName,
} from "@ai-app-template/domain";

import type { CreateSessionInput, JsonValue, SessionSnapshot } from "../types.js";

export interface EnqueueBackgroundTaskInput {
  kind: BackgroundTaskKind;
  executor?: BackgroundTaskExecutor;
  parentSessionId?: string | null;
  childSessionId?: string | null;
  message: string;
  workingDirectory: string;
  model: string;
  maxTurns?: number;
  deadlineAt?: string | null;
  maxAttempts?: number;
  permissionReply?: boolean;
  userId?: string;
  enabledCapabilityPacks?: CapabilityPackName[];
  metadata?: Record<string, JsonValue>;
  taskState?: BackgroundTaskState | null;
  command?: string;
  timeoutMs?: number;
  waitMode?: BackgroundTaskWaitMode;
  sessionSeed?: Partial<CreateSessionInput>;
  availableAt?: string | null;
}

export interface BackgroundTaskManager {
  enqueueTask(input: EnqueueBackgroundTaskInput): Promise<BackgroundTaskRecord>;
  claimNextTask(workerId: string): Promise<BackgroundTaskClaim | null>;
  heartbeatTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
  }): Promise<BackgroundTaskClaim | null>;
  markTaskRunning(input: {
    taskId: string;
    runId: string;
    workerId: string;
  }): Promise<BackgroundTaskClaim>;
  markTaskWaitingForInput(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }): Promise<BackgroundTaskClaim>;
  markTaskWaitingForMainAgent(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }): Promise<BackgroundTaskClaim>;
  completeTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }): Promise<BackgroundTaskClaim>;
  failTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    errorSummary: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }): Promise<BackgroundTaskClaim>;
  requestCancel(taskId: string): Promise<BackgroundTaskRecord | null>;
  cancelTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }): Promise<BackgroundTaskClaim>;
  getTask(taskId: string): Promise<BackgroundTaskRecord | null>;
  getWakeupTaskBySessionId(
    sessionId: string
  ): Promise<BackgroundTaskRecord | null>;
  rescheduleQueuedTask(input: {
    taskId: string;
    payload?: BackgroundTaskPayload;
    resultSummary?: string | null;
    lastError?: string | null;
    availableAt?: string | null;
    deadlineAt?: string | null;
  }): Promise<BackgroundTaskRecord>;
  requeueTask(input: {
    taskId: string;
    payload?: BackgroundTaskPayload;
    taskState?: BackgroundTaskState | null;
    resultSummary?: string | null;
    lastError?: string | null;
    availableAt?: string | null;
    deadlineAt?: string | null;
    maxAttempts?: number;
  }): Promise<BackgroundTaskRecord>;
  requeueStaleClaims(staleBefore: string): Promise<BackgroundTaskRecord[]>;
  listTasksByParentSession(
    parentSessionId: string
  ): Promise<BackgroundTaskRecord[]>;
}

export interface BackgroundTaskRuntimeHandle {
  runtime: {
    run(input: {
      sessionId: string;
      message?: string;
      maxTurns?: number;
      permissionReply?: boolean;
    }): Promise<{
      session: SessionSnapshot;
      finalAnswer: string | null;
      status: string;
      stopReason: string | null;
    }>;
  };
  dispose(): Promise<void>;
  preRunTraceEvent?: import("../trace.js").TraceEvent;
}
