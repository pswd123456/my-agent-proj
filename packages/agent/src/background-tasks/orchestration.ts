import type {
  AgentSessionBackgroundTaskPayload,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  DomainJsonValue
} from "@ai-app-template/domain";

import type { SessionManager } from "../session/contracts.js";

import type { BackgroundTaskManager } from "./contracts.js";

const MAX_POLL_INTERVAL_MS = 120_000;

function isActiveWakeupStatus(status: BackgroundTaskStatus): boolean {
  return (
    status === "queued" ||
    status === "claimed" ||
    status === "running" ||
    status === "cancelling"
  );
}

function clampPollIntervalMs(value: number): number {
  return Math.max(1_000, Math.min(MAX_POLL_INTERVAL_MS, Math.floor(value)));
}

function shouldMoveWakeupEarlier(input: {
  currentAvailableAt: string | null;
  nextAvailableAt: string;
}): boolean {
  return (
    typeof input.currentAvailableAt === "string" &&
    input.nextAvailableAt < input.currentAvailableAt
  );
}

function mergeTaskIds(existingTaskIds: string[], taskIds: string[]): string[] {
  return [...new Set([...existingTaskIds, ...taskIds])];
}

export function buildBackgroundTaskPollMetadata(input: {
  taskIds: string[];
  nextIntervalMs: number;
}): Record<string, DomainJsonValue> {
  return {
    reason: "background_task_poll",
    backgroundTaskIds: input.taskIds,
    nextIntervalMs: input.nextIntervalMs
  };
}

export function parseBackgroundTaskPollMetadata(
  task: BackgroundTaskRecord
): { taskIds: string[]; nextIntervalMs: number } | null {
  const metadata = task.payload.metadata;
  const taskIdsSource =
    metadata.reason === "background_task_poll"
      ? metadata.backgroundTaskIds
      : metadata.reason === "delegate_poll"
        ? metadata.delegateTaskIds
        : null;
  if (!Array.isArray(taskIdsSource)) {
    return null;
  }

  const taskIds = taskIdsSource.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
  if (taskIds.length === 0) {
    return null;
  }

  return {
    taskIds: [...new Set(taskIds)],
    nextIntervalMs:
      typeof metadata.nextIntervalMs === "number" &&
      Number.isFinite(metadata.nextIntervalMs)
        ? clampPollIntervalMs(metadata.nextIntervalMs)
        : 5_000
  };
}

function withWakeupMetadata(
  task: BackgroundTaskRecord,
  metadata: Record<string, DomainJsonValue>,
  message?: string
): AgentSessionBackgroundTaskPayload {
  return {
    ...(task.payload as AgentSessionBackgroundTaskPayload),
    message: typeof message === "string" ? message : "",
    permissionReply: false,
    metadata: {
      ...(task.payload as AgentSessionBackgroundTaskPayload).metadata,
      ...metadata
    }
  };
}

export async function scheduleBackgroundTaskPollWakeup(input: {
  sessionManager: SessionManager;
  taskManager: BackgroundTaskManager;
  parentSessionId: string;
  taskIds: string[];
  initialCheckAfterMs: number;
  wakeupMessage?: string;
  extraMetadata?: Record<string, DomainJsonValue>;
}): Promise<void> {
  const taskIds = [...new Set(input.taskIds.filter(Boolean))];
  if (taskIds.length === 0) {
    return;
  }

  const parentSession = await input.sessionManager.getSession(
    input.parentSessionId
  );
  if (!parentSession) {
    return;
  }

  const intervalMs = clampPollIntervalMs(input.initialCheckAfterMs);
  const availableAt = new Date(Date.now() + intervalMs).toISOString();
  const metadata = buildBackgroundTaskPollMetadata({
    taskIds,
    nextIntervalMs: intervalMs
  });
  const nextMetadata = {
    ...metadata,
    ...(input.extraMetadata ?? {})
  };
  const existingWakeup = await input.taskManager.getWakeupTaskBySessionId(
    parentSession.sessionId
  );
  const existingPoll = existingWakeup
    ? parseBackgroundTaskPollMetadata(existingWakeup)
    : null;

  if (existingWakeup && isActiveWakeupStatus(existingWakeup.status)) {
    // Keep a queued poll wakeup tracking every active task id we know about.
    if (existingWakeup.status === "queued" && existingPoll) {
      const mergedTaskIds = mergeTaskIds(existingPoll.taskIds, taskIds);
      const existingMoveEarlier = shouldMoveWakeupEarlier({
        currentAvailableAt: existingWakeup.availableAt,
        nextAvailableAt: availableAt
      });
      const nextIntervalMs = existingMoveEarlier
        ? intervalMs
        : existingPoll.nextIntervalMs;

      await input.taskManager.rescheduleQueuedTask({
        taskId: existingWakeup.taskId,
        payload: withWakeupMetadata(
          existingWakeup,
          {
            ...buildBackgroundTaskPollMetadata({
              taskIds: mergedTaskIds,
              nextIntervalMs
            }),
            ...(input.extraMetadata ?? {})
          },
          input.wakeupMessage ?? existingWakeup.payload.message
        ),
        ...(existingMoveEarlier ? { availableAt } : {}),
        resultSummary: null,
        lastError: null
      });
      return;
    }

    if (existingWakeup.status === "queued") {
      const moveEarlier = shouldMoveWakeupEarlier({
        currentAvailableAt: existingWakeup.availableAt,
        nextAvailableAt: availableAt
      });
      if (!moveEarlier) {
        return;
      }

      await input.taskManager.rescheduleQueuedTask({
        taskId: existingWakeup.taskId,
        payload: withWakeupMetadata(
          existingWakeup,
          nextMetadata,
          input.wakeupMessage ?? existingWakeup.payload.message
        ),
        availableAt,
        resultSummary: null,
        lastError: null
      });
    }
    return;
  }

  if (existingWakeup) {
    await input.taskManager.requeueTask({
      taskId: existingWakeup.taskId,
      payload: withWakeupMetadata(
        existingWakeup,
        nextMetadata,
        input.wakeupMessage ?? existingWakeup.payload.message
      ),
      availableAt,
      resultSummary: null,
      lastError: null,
      maxAttempts: 1
    });
    return;
  }

  await input.taskManager.enqueueTask({
    kind: "session_wakeup",
    parentSessionId: parentSession.sessionId,
    childSessionId: parentSession.sessionId,
    message: input.wakeupMessage ?? "",
    workingDirectory: parentSession.workingDirectory,
    model: parentSession.model,
    maxTurns: parentSession.maxTurns,
    enabledCapabilityPacks: parentSession.context.enabledCapabilityPacks,
    metadata: nextMetadata,
    maxAttempts: 1,
    availableAt
  });
}
