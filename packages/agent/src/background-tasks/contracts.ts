import type {
  BackgroundTaskPayload,
  BackgroundTaskKind,
  BackgroundTaskRecord,
  BackgroundTaskState,
  BackgroundTaskExecutor,
  BackgroundTaskWaitMode,
  CapabilityPackName
} from "@ai-app-template/domain";
import type { BackgroundTaskRepository } from "@ai-app-template/db";

import type {
  CreateSessionInput,
  JsonValue,
  SessionSnapshot
} from "../types.js";

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
  enabledCapabilityPacks?: CapabilityPackName[];
  metadata?: Record<string, JsonValue>;
  taskState?: BackgroundTaskState | null;
  command?: string;
  timeoutMs?: number;
  sourceSessionId?: string;
  stageKey?: string;
  memoryDirectory?: string | null;
  waitMode?: BackgroundTaskWaitMode;
  sessionSeed?: Partial<CreateSessionInput>;
  availableAt?: string | null;
}

type BackgroundTaskRepositoryManagerMethods = Pick<
  BackgroundTaskRepository,
  | "claimNextTask"
  | "heartbeatTask"
  | "markTaskRunning"
  | "markTaskWaitingForInput"
  | "markTaskWaitingForMainAgent"
  | "completeTask"
  | "failTask"
  | "requestCancel"
  | "cancelTask"
  | "getTask"
  | "getWakeupTaskBySessionId"
  | "rescheduleQueuedTask"
  | "requeueTask"
  | "requeueStaleClaims"
>;

export interface BackgroundTaskManager extends BackgroundTaskRepositoryManagerMethods {
  enqueueTask(input: EnqueueBackgroundTaskInput): Promise<BackgroundTaskRecord>;
  listTasksByParentSession(
    parentSessionId: string
  ): Promise<BackgroundTaskRecord[]>;
}

export interface BackgroundTaskRuntimeHandle {
  runtime: {
    run(input: {
      sessionId: string;
      runId?: string;
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
