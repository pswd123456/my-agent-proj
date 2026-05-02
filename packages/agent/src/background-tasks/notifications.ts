import { randomUUID } from "node:crypto";

import type {
  AgentSessionBackgroundTaskPayload,
  BackgroundNotificationKind,
  BackgroundNotificationRequest,
  BackgroundTaskRecord,
  BackgroundTaskResultEnvelope,
  DelegateExpectedParentReply,
  DomainJsonValue,
  ScheduleSessionContext,
  SessionBackgroundNotification
} from "@ai-app-template/domain";

import type { RunEventSink } from "../events.js";
import type { SessionManager } from "../session/contracts.js";
import type { TraceManager } from "../trace.js";

import type { BackgroundTaskManager } from "./contracts.js";
import { emitTraceEvent } from "../runtime/run-events.js";

function canAutoWakeSession(context: ScheduleSessionContext): boolean {
  return (
    context.status !== "waiting_for_permission" &&
    context.status !== "waiting_for_conflict_confirmation" &&
    context.status !== "waiting_for_user_question"
  );
}

function createNotification(input: {
  task: BackgroundTaskRecord;
  kind: BackgroundNotificationKind;
  title?: string;
  summary: string;
  content: string;
  expectedParentReply: DelegateExpectedParentReply;
  request?: BackgroundNotificationRequest | null;
  result?: BackgroundTaskResultEnvelope | null;
}): SessionBackgroundNotification {
  const delegateTitle =
    input.task.taskState?.kind === "delegate"
      ? input.task.taskState.title
      : null;
  return {
    id: randomUUID(),
    kind: input.kind,
    taskId: input.task.taskId,
    taskKind: input.task.kind,
    childSessionId: input.task.childSessionId,
    title:
      input.title ??
      delegateTitle ??
      (input.task.kind === "session_wakeup"
        ? "主会话后台续跑"
        : input.task.kind === "shell_command"
          ? "后台任务"
          : "后台子任务"),
    summary: input.summary,
    content: input.content,
    createdAt: new Date().toISOString(),
    requiresMainAgentReply: input.expectedParentReply !== "none",
    expectedParentReply: input.expectedParentReply,
    ...(input.request ? { request: structuredClone(input.request) } : {}),
    ...(typeof input.result !== "undefined"
      ? { result: structuredClone(input.result) }
      : {})
  };
}

function toAgentSessionPayload(
  task: BackgroundTaskRecord
): AgentSessionBackgroundTaskPayload {
  if (task.payload.executor !== "agent_session") {
    throw new Error(
      `Expected agent_session payload for task ${task.taskId}, received ${task.payload.executor}.`
    );
  }

  return task.payload;
}

export async function incrementSessionBackgroundTaskCount(input: {
  sessionManager: SessionManager;
  sessionId: string;
  delta: number;
}): Promise<void> {
  const session = await input.sessionManager.getSession(input.sessionId);
  if (!session) {
    return;
  }

  await input.sessionManager.updateContext(input.sessionId, {
    activeBackgroundTaskCount: Math.max(
      0,
      session.context.activeBackgroundTaskCount + input.delta
    )
  });
}

export async function enqueueBackgroundNotification(input: {
  sessionManager: SessionManager;
  traceManager?: TraceManager | undefined;
  taskManager: BackgroundTaskManager;
  task: BackgroundTaskRecord;
  kind: BackgroundNotificationKind;
  title?: string;
  summary: string;
  content: string;
  expectedParentReply?: DelegateExpectedParentReply;
  request?: BackgroundNotificationRequest | null;
  result?: BackgroundTaskResultEnvelope | null;
  decrementActiveTaskCount?: boolean;
  autoWake?: boolean;
  wakeupMessage?: string;
  wakeupMetadata?: Record<string, DomainJsonValue>;
}): Promise<SessionBackgroundNotification | null> {
  if (!input.task.parentSessionId) {
    return null;
  }

  const parentSession = await input.sessionManager.getSession(
    input.task.parentSessionId
  );
  if (!parentSession) {
    return null;
  }

  const notification = createNotification({
    task: input.task,
    kind: input.kind,
    ...(input.title ? { title: input.title } : {}),
    summary: input.summary,
    content: input.content,
    expectedParentReply: input.expectedParentReply ?? "none",
    ...(typeof input.request !== "undefined" ? { request: input.request } : {}),
    ...(typeof input.result !== "undefined" ? { result: input.result } : {})
  });

  const updatedSession = await input.sessionManager.updateContext(
    parentSession.sessionId,
    {
      activeBackgroundTaskCount: Math.max(
        0,
        parentSession.context.activeBackgroundTaskCount -
          (input.decrementActiveTaskCount ? 1 : 0)
      ),
      pendingBackgroundNotifications: [
        ...parentSession.context.pendingBackgroundNotifications,
        notification
      ]
    }
  );

  if (input.traceManager) {
    await input.traceManager.appendEvent(parentSession.sessionId, {
      kind: "background_notification",
      turnCount: updatedSession.sessionState.turnCount,
      notification
    });
  }

  if (
    input.autoWake === false ||
    !canAutoWakeSession(updatedSession.context) ||
    (await input.sessionManager.isExecutionActive(parentSession.sessionId))
  ) {
    return notification;
  }

  const existingWakeup = await input.taskManager.getWakeupTaskBySessionId(
    parentSession.sessionId
  );
  const now = new Date().toISOString();
  if (
    existingWakeup &&
    (existingWakeup.status === "queued" ||
      existingWakeup.status === "claimed" ||
      existingWakeup.status === "running" ||
      existingWakeup.status === "cancelling")
  ) {
    if (
      existingWakeup.status === "queued" &&
      existingWakeup.availableAt &&
      existingWakeup.availableAt > now
    ) {
      const payload = toAgentSessionPayload(existingWakeup);
      await input.taskManager.rescheduleQueuedTask({
        taskId: existingWakeup.taskId,
        payload: {
          ...payload,
          message: input.wakeupMessage ?? "",
          permissionReply: false,
          metadata: {
            ...payload.metadata,
            reason: "background_notification",
            ...(input.wakeupMetadata ?? {})
          }
        },
        availableAt: null,
        resultSummary: null,
        lastError: null
      });
    }
    return notification;
  }

  if (existingWakeup) {
    const payload = toAgentSessionPayload(existingWakeup);
    await input.taskManager.requeueTask({
      taskId: existingWakeup.taskId,
      payload: {
        ...payload,
        message: input.wakeupMessage ?? "",
        permissionReply: false,
        metadata: {
          ...payload.metadata,
          reason: "background_notification",
          ...(input.wakeupMetadata ?? {})
        }
      },
      resultSummary: null,
      lastError: null,
      availableAt: null
    });
    return notification;
  }

  await input.taskManager.enqueueTask({
    kind: "session_wakeup",
    parentSessionId: parentSession.sessionId,
    childSessionId: parentSession.sessionId,
    message: input.wakeupMessage ?? "",
    workingDirectory: parentSession.workingDirectory,
    model: parentSession.model,
    maxTurns: parentSession.maxTurns,
    userId: parentSession.context.userId,
    enabledCapabilityPacks: parentSession.context.enabledCapabilityPacks,
    metadata: {
      reason: "background_notification",
      ...(input.wakeupMetadata ?? {})
    },
    maxAttempts: 1
  });

  return notification;
}

export async function consumeBackgroundNotifications(input: {
  sessionManager: SessionManager;
  traceManager?: TraceManager | undefined;
  eventSink?: RunEventSink | undefined;
  sessionId: string;
  turnCount: number;
  notificationIds: string[];
}): Promise<void> {
  if (input.notificationIds.length === 0) {
    return;
  }

  const session = await input.sessionManager.getSession(input.sessionId);
  if (!session) {
    return;
  }

  const idSet = new Set(input.notificationIds);
  const consumed = session.context.pendingBackgroundNotifications.filter(
    (notification) => idSet.has(notification.id)
  );
  if (consumed.length === 0) {
    return;
  }

  await input.sessionManager.updateContext(session.sessionId, {
    pendingBackgroundNotifications:
      session.context.pendingBackgroundNotifications.filter(
        (notification) => !idSet.has(notification.id)
      )
  });

  for (const notification of consumed) {
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "background_notification_consumed",
        turnCount: input.turnCount,
        notification: {
          ...notification,
          consumedAt: new Date().toISOString()
        }
      }
    });
  }
}
