import type {
  BackgroundTaskClaim,
  BackgroundTaskPayload,
  BackgroundTaskKind,
  BackgroundTaskRecord,
  CapabilityPackName,
  DelegateTaskCard
} from "@ai-app-template/domain";

import type { CreateSessionInput, JsonValue, SessionSnapshot } from "../types.js";

export interface EnqueueBackgroundTaskInput {
  kind: BackgroundTaskKind;
  parentSessionId?: string | null;
  message: string;
  workingDirectory: string;
  model: string;
  maxTurns?: number;
  permissionReply?: boolean;
  userId?: string;
  enabledCapabilityPacks?: CapabilityPackName[];
  metadata?: Record<string, JsonValue>;
  taskCard?: DelegateTaskCard | null;
  sessionSeed?: Partial<CreateSessionInput>;
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
    taskCard?: DelegateTaskCard | null;
  }): Promise<BackgroundTaskClaim>;
  markTaskWaitingForMainAgent(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskCard?: DelegateTaskCard | null;
  }): Promise<BackgroundTaskClaim>;
  completeTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskCard?: DelegateTaskCard | null;
  }): Promise<BackgroundTaskClaim>;
  failTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    errorSummary: string;
    resultSummary?: string | null;
    taskCard?: DelegateTaskCard | null;
  }): Promise<BackgroundTaskClaim>;
  requestCancel(taskId: string): Promise<BackgroundTaskRecord | null>;
  cancelTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskCard?: DelegateTaskCard | null;
  }): Promise<BackgroundTaskClaim>;
  getTask(taskId: string): Promise<BackgroundTaskRecord | null>;
  requeueTask(input: {
    taskId: string;
    payload?: BackgroundTaskPayload;
    taskCard?: DelegateTaskCard | null;
    resultSummary?: string | null;
    lastError?: string | null;
  }): Promise<BackgroundTaskRecord>;
  requeueStaleClaims(staleBefore: string): Promise<number>;
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
