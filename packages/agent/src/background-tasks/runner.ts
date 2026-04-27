import type {
  BackgroundTaskClaim,
  BackgroundNotificationKind,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  DelegateExpectedParentReply,
  DelegateRequestEnvelope,
  DelegateResponseEnvelope,
  DelegateTaskCard,
  PendingConfirmationPayload,
  PendingPermissionRequest,
  PendingUserQuestionPayload
} from "@ai-app-template/domain";

import type { TraceManager } from "../trace.js";
import type { SessionManager } from "../session/contracts.js";
import type { RunSessionResult } from "../types.js";

import type {
  BackgroundTaskManager,
  BackgroundTaskRuntimeHandle
} from "./contracts.js";
import { enqueueBackgroundNotification } from "./notifications.js";

const DELEGATE_POLL_MAX_INTERVAL_MS = 120_000;

export interface RunBackgroundTaskInput {
  claim: BackgroundTaskClaim;
  workerId: string;
  heartbeatIntervalMs: number;
  sessionManager: SessionManager;
  taskManager: BackgroundTaskManager;
  traceManager?: TraceManager;
  createRuntimeHandle(
    session: Awaited<ReturnType<SessionManager["getSession"]>>
  ): Promise<BackgroundTaskRuntimeHandle>;
}

function summarizeResult(result: RunSessionResult): string | null {
  if (
    typeof result.finalAnswer === "string" &&
    result.finalAnswer.trim().length > 0
  ) {
    return result.finalAnswer;
  }
  if (typeof result.stopReason === "string" && result.stopReason.length > 0) {
    return result.stopReason;
  }
  return null;
}

function isHumanInputPause(result: RunSessionResult): boolean {
  return (
    result.session.context.status === "waiting_for_permission" ||
    result.session.context.status === "waiting_for_conflict_confirmation" ||
    result.session.context.status === "waiting_for_user_question"
  );
}

function updateDelegateTaskCard(
  claim: BackgroundTaskClaim,
  input: {
    response: DelegateResponseEnvelope;
    expectedParentReply: DelegateExpectedParentReply;
  }
): DelegateTaskCard | null {
  if (!claim.task.taskCard) {
    return null;
  }

  return {
    ...claim.task.taskCard,
    latestResponse: input.response,
    expectedParentReply: input.expectedParentReply
  };
}

function buildPermissionRequest(
  payload: PendingPermissionRequest
): DelegateRequestEnvelope {
  return {
    kind: "permission_request",
    summary: payload.summaryText,
    data: {
      toolName: payload.toolName,
      summaryText: payload.summaryText,
      ...(payload.contextNote ? { contextNote: payload.contextNote } : {})
    }
  };
}

function buildUserQuestionRequest(
  payload: PendingUserQuestionPayload
): DelegateRequestEnvelope {
  return {
    kind: "user_question",
    summary: payload.questionText,
    data: {
      questionText: payload.questionText,
      options: payload.options.map((option) => ({
        label: option.label,
        reply: option.reply,
        ...(option.description ? { description: option.description } : {}),
        ...(option.isRecommended ? { isRecommended: true } : {})
      })),
      ...(payload.contextNote ? { contextNote: payload.contextNote } : {})
    }
  };
}

function buildConfirmationRequest(
  payload: PendingConfirmationPayload
): DelegateRequestEnvelope {
  return {
    kind: "confirmation_request",
    summary: payload.summaryText,
    data: {
      summaryText: payload.summaryText,
      proposedItems: payload.proposedItems.map((item) => ({
        previewText: item.previewText,
        ...(item.toolName ? { toolName: item.toolName } : {})
      })),
      conflictItems: (payload.conflictItems ?? []).map((item) => ({
        routineId: item.routineId,
        previewText: item.previewText
      })),
      ...(payload.contextNote ? { contextNote: payload.contextNote } : {})
    }
  };
}

function buildDelegateMainAgentRequest(result: RunSessionResult): {
  request: DelegateRequestEnvelope;
  expectedParentReply: DelegateExpectedParentReply;
  summary: string;
  content: string;
} | null {
  if (result.session.context.pendingPermissionRequest) {
    const request = buildPermissionRequest(
      result.session.context.pendingPermissionRequest
    );
    return {
      request,
      expectedParentReply: "permission_decision",
      summary: request.summary,
      content: `Subagent needs a permission decision.\n${request.summary}`
    };
  }

  if (result.session.context.pendingUserQuestionPayload) {
    const request = buildUserQuestionRequest(
      result.session.context.pendingUserQuestionPayload
    );
    return {
      request,
      expectedParentReply: "message",
      summary: request.summary,
      content: `Subagent needs more input.\n${request.summary}`
    };
  }

  if (result.session.context.pendingConfirmationPayload) {
    const request = buildConfirmationRequest(
      result.session.context.pendingConfirmationPayload
    );
    return {
      request,
      expectedParentReply: "message",
      summary: request.summary,
      content: `Subagent needs the main agent to resolve a confirmation step.\n${request.summary}`
    };
  }

  return null;
}

function hasTaskExpired(task: BackgroundTaskRecord, now = Date.now()): boolean {
  if (!task.deadlineAt) {
    return false;
  }

  return new Date(task.deadlineAt).getTime() <= now;
}

function isActiveDelegateStatus(status: BackgroundTaskStatus): boolean {
  return (
    status === "queued" ||
    status === "claimed" ||
    status === "running" ||
    status === "cancelling"
  );
}

function parseDelegatePollMetadata(
  task: BackgroundTaskRecord
): { delegateIds: string[]; nextIntervalMs: number } | null {
  const metadata = task.payload.metadata;
  if (metadata.reason !== "delegate_poll") {
    return null;
  }
  if (!Array.isArray(metadata.delegateTaskIds)) {
    return null;
  }

  const delegateIds = metadata.delegateTaskIds.filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
  if (delegateIds.length === 0) {
    return null;
  }

  return {
    delegateIds: [...new Set(delegateIds)],
    nextIntervalMs:
      typeof metadata.nextIntervalMs === "number" &&
      Number.isFinite(metadata.nextIntervalMs)
        ? Math.max(
            1_000,
            Math.min(DELEGATE_POLL_MAX_INTERVAL_MS, metadata.nextIntervalMs)
          )
        : 5_000
  };
}

async function maybeHandleDelegatePollWakeup(input: {
  claim: BackgroundTaskClaim;
  workerId: string;
  taskManager: BackgroundTaskManager;
}): Promise<boolean> {
  if (input.claim.task.kind !== "session_wakeup") {
    return false;
  }

  const poll = parseDelegatePollMetadata(input.claim.task);
  if (!poll) {
    return false;
  }

  const delegateTasks = await Promise.all(
    poll.delegateIds.map((delegateId) => input.taskManager.getTask(delegateId))
  );
  const activeDelegateIds = delegateTasks
    .filter(
      (task): task is BackgroundTaskRecord =>
        !!task &&
        task.kind === "subagent" &&
        isActiveDelegateStatus(task.status)
    )
    .map((task) => task.taskId);

  if (activeDelegateIds.length === 0) {
    return false;
  }

  const completedClaim = await input.taskManager.completeTask({
    taskId: input.claim.task.taskId,
    runId: input.claim.run.runId,
    workerId: input.workerId,
    resultSummary: "Delegate poll found active subagent work."
  });
  const nextIntervalMs = Math.min(
    poll.nextIntervalMs * 2,
    DELEGATE_POLL_MAX_INTERVAL_MS
  );
  await input.taskManager.requeueTask({
    taskId: completedClaim.task.taskId,
    payload: {
      ...completedClaim.task.payload,
      message: "",
      permissionReply: false,
      metadata: {
        reason: "delegate_poll",
        delegateTaskIds: activeDelegateIds,
        nextIntervalMs
      }
    },
    availableAt: new Date(Date.now() + nextIntervalMs).toISOString(),
    resultSummary: null,
    lastError: null,
    maxAttempts: 1
  });
  return true;
}

async function notifySubagentParent(input: {
  sessionManager: SessionManager;
  traceManager?: TraceManager | undefined;
  taskManager: BackgroundTaskManager;
  task: BackgroundTaskRecord;
  kind: BackgroundNotificationKind;
  fallbackSummary: string;
  fallbackContent: string;
}): Promise<void> {
  const latestResponse = input.task.taskCard?.latestResponse;
  await enqueueBackgroundNotification({
    sessionManager: input.sessionManager,
    traceManager: input.traceManager,
    taskManager: input.taskManager,
    task: input.task,
    kind: input.kind,
    summary: latestResponse?.summary ?? input.fallbackSummary,
    content: latestResponse?.content ?? input.fallbackContent,
    expectedParentReply: input.task.taskCard?.expectedParentReply ?? "none",
    request: latestResponse?.request ?? null,
    decrementActiveTaskCount: true
  });
}

async function notifyWakeupSession(input: {
  sessionManager: SessionManager;
  traceManager?: TraceManager | undefined;
  taskManager: BackgroundTaskManager;
  task: BackgroundTaskRecord;
  kind: BackgroundNotificationKind;
  summary: string;
  content: string;
}): Promise<void> {
  await enqueueBackgroundNotification({
    sessionManager: input.sessionManager,
    traceManager: input.traceManager,
    taskManager: input.taskManager,
    task: input.task,
    kind: input.kind,
    title: "主会话后台续跑",
    summary: input.summary,
    content: input.content,
    expectedParentReply: "none",
    autoWake: false
  });
}

export async function runBackgroundTask(
  input: RunBackgroundTaskInput
): Promise<void> {
  const { claim, workerId } = input;
  const initialSession = await input.sessionManager.getSession(
    claim.task.childSessionId
  );

  if (!initialSession) {
    const failedClaim = await input.taskManager.failTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      errorSummary: `Child session not found: ${claim.task.childSessionId}`
    });
    if (claim.task.kind === "subagent") {
      await notifySubagentParent({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: failedClaim.task,
        kind: "delegate_failed",
        fallbackSummary: "后台子任务失败。",
        fallbackContent: `Child session not found: ${claim.task.childSessionId}`
      });
    }
    return;
  }

  if (claim.task.kind === "session_wakeup") {
    if (
      await maybeHandleDelegatePollWakeup({
        claim,
        workerId,
        taskManager: input.taskManager
      })
    ) {
      return;
    }

    const alreadyRunning = await input.sessionManager.isExecutionActive(
      initialSession.sessionId
    );
    if (
      alreadyRunning ||
      initialSession.context.status === "waiting_for_permission" ||
      initialSession.context.status === "waiting_for_conflict_confirmation" ||
      initialSession.context.status === "waiting_for_user_question"
    ) {
      await input.taskManager.completeTask({
        taskId: claim.task.taskId,
        runId: claim.run.runId,
        workerId,
        resultSummary:
          "Wakeup skipped while the main session is waiting on a guarded state."
      });
      return;
    }
  }

  if (hasTaskExpired(claim.task)) {
    const timedOutClaim = await input.taskManager.failTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      errorSummary:
        "Background task exceeded its deadline before execution started."
    });
    if (claim.task.kind === "subagent") {
      await notifySubagentParent({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: timedOutClaim.task,
        kind: "delegate_timeout",
        fallbackSummary: "后台子任务超时。",
        fallbackContent:
          "Background task exceeded its deadline before execution started."
      });
    } else if (claim.task.kind === "session_wakeup") {
      await notifyWakeupSession({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: timedOutClaim.task,
        kind: "delegate_timeout",
        summary: "主会话后台续跑超时。",
        content:
          "Background task exceeded its deadline before execution started."
      });
    }
    return;
  }

  const runtimeHandle = await input.createRuntimeHandle(initialSession);
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let heartbeatInFlight = false;
  let interruptRequested = false;

  try {
    if (runtimeHandle.preRunTraceEvent && input.traceManager) {
      await input.traceManager.appendEvent(
        claim.task.childSessionId,
        runtimeHandle.preRunTraceEvent
      );
    }

    await input.taskManager.markTaskRunning({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId
    });

    heartbeat = setInterval(() => {
      if (heartbeatInFlight) {
        return;
      }
      heartbeatInFlight = true;
      void input.taskManager
        .heartbeatTask({
          taskId: claim.task.taskId,
          runId: claim.run.runId,
          workerId
        })
        .then((heartbeatClaim) => {
          if (
            heartbeatClaim?.task.status === "cancelling" &&
            !interruptRequested
          ) {
            interruptRequested = true;
            void input.sessionManager.requestInterrupt(
              claim.task.childSessionId
            );
          }
          if (
            heartbeatClaim?.task &&
            hasTaskExpired(heartbeatClaim.task) &&
            !interruptRequested
          ) {
            interruptRequested = true;
            void input.sessionManager.requestInterrupt(
              claim.task.childSessionId
            );
          }
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, input.heartbeatIntervalMs);

    const resultInput = {
      sessionId: claim.task.childSessionId,
      maxTurns: claim.task.payload.maxTurns,
      ...(claim.task.payload.message.trim().length > 0
        ? { message: claim.task.payload.message }
        : {}),
      ...(typeof claim.task.payload.permissionReply === "boolean"
        ? { permissionReply: claim.task.payload.permissionReply }
        : {})
    };
    const result = (await runtimeHandle.runtime.run(
      resultInput
    )) as RunSessionResult;

    const resultSummary = summarizeResult(result);
    if (hasTaskExpired(claim.task)) {
      const timedOutClaim = await input.taskManager.failTask({
        taskId: claim.task.taskId,
        runId: claim.run.runId,
        workerId,
        errorSummary: "Background task exceeded its deadline."
      });
      if (claim.task.kind === "subagent") {
        await notifySubagentParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: timedOutClaim.task,
          kind: "delegate_timeout",
          fallbackSummary: "后台子任务超时。",
          fallbackContent: "Background task exceeded its deadline."
        });
      } else if (claim.task.kind === "session_wakeup") {
        await notifyWakeupSession({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: timedOutClaim.task,
          kind: "delegate_timeout",
          summary: "主会话后台续跑超时。",
          content: "Background task exceeded its deadline."
        });
      }
      return;
    }

    if (
      result.status === "interrupted" ||
      result.stopReason === "interrupted_by_user"
    ) {
      const taskCard = updateDelegateTaskCard(claim, {
        response: {
          kind: "cancelled",
          summary: resultSummary ?? "Delegate cancelled.",
          content: resultSummary ?? "Delegate cancelled.",
          request: null
        },
        expectedParentReply: "none"
      });
      const cancelledClaim = await input.taskManager.cancelTask({
        taskId: claim.task.taskId,
        runId: claim.run.runId,
        workerId,
        resultSummary,
        ...(taskCard ? { taskCard } : {})
      });
      if (claim.task.kind === "subagent") {
        await notifySubagentParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: cancelledClaim.task,
          kind: "delegate_cancelled",
          fallbackSummary: "后台子任务已取消。",
          fallbackContent: resultSummary ?? "Delegate cancelled."
        });
      }
      return;
    }

    if (isHumanInputPause(result)) {
      if (claim.task.kind === "subagent") {
        const request = buildDelegateMainAgentRequest(result);
        const taskCard =
          request &&
          updateDelegateTaskCard(claim, {
            response: {
              kind: "needs_main_agent",
              summary: request.summary,
              content: request.content,
              request: request.request
            },
            expectedParentReply: request.expectedParentReply
          });

        const waitingClaim =
          await input.taskManager.markTaskWaitingForMainAgent({
            taskId: claim.task.taskId,
            runId: claim.run.runId,
            workerId,
            resultSummary: taskCard?.latestResponse?.summary ?? resultSummary,
            ...(taskCard ? { taskCard } : {})
          });
        await notifySubagentParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: waitingClaim.task,
          kind: "delegate_needs_main_agent",
          fallbackSummary:
            taskCard?.latestResponse?.summary ?? "后台子任务需要主代理处理。",
          fallbackContent:
            taskCard?.latestResponse?.content ??
            "Subagent needs the main agent to continue."
        });
      } else {
        await input.taskManager.markTaskWaitingForInput({
          taskId: claim.task.taskId,
          runId: claim.run.runId,
          workerId,
          resultSummary
        });
      }
      return;
    }

    if (result.status === "failed") {
      const taskCard =
        claim.task.kind === "subagent"
          ? updateDelegateTaskCard(claim, {
              response: {
                kind: "failed",
                summary:
                  result.session.sessionState.lastError ??
                  result.stopReason ??
                  "Delegate failed.",
                content:
                  result.finalAnswer ??
                  result.session.sessionState.lastError ??
                  result.stopReason ??
                  "Delegate failed.",
                request: null
              },
              expectedParentReply: "none"
            })
          : null;
      const failedClaim = await input.taskManager.failTask({
        taskId: claim.task.taskId,
        runId: claim.run.runId,
        workerId,
        errorSummary:
          result.session.sessionState.lastError ??
          result.stopReason ??
          "Background task failed.",
        resultSummary,
        ...(taskCard ? { taskCard } : {})
      });
      if (claim.task.kind === "subagent") {
        await notifySubagentParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: failedClaim.task,
          kind: "delegate_failed",
          fallbackSummary: "后台子任务失败。",
          fallbackContent:
            result.finalAnswer ??
            result.session.sessionState.lastError ??
            result.stopReason ??
            "Delegate failed."
        });
      } else if (claim.task.kind === "session_wakeup") {
        await notifyWakeupSession({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: failedClaim.task,
          kind: "delegate_failed",
          summary: "主会话后台续跑失败。",
          content:
            result.finalAnswer ??
            result.session.sessionState.lastError ??
            result.stopReason ??
            "Wakeup run failed."
        });
      }
      return;
    }

    const taskCard =
      claim.task.kind === "subagent"
        ? updateDelegateTaskCard(claim, {
            response: {
              kind: "message",
              summary: resultSummary ?? "Delegate completed.",
              content:
                result.finalAnswer ?? resultSummary ?? "Delegate completed.",
              request: null
            },
            expectedParentReply: "none"
          })
        : null;
    const completedClaim = await input.taskManager.completeTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      resultSummary,
      ...(taskCard ? { taskCard } : {})
    });
    if (claim.task.kind === "subagent") {
      await notifySubagentParent({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: completedClaim.task,
        kind: "delegate_completed",
        fallbackSummary: "后台子任务已完成。",
        fallbackContent:
          result.finalAnswer ?? resultSummary ?? "Delegate completed."
      });
    }
  } catch (error) {
    const taskCard =
      claim.task.kind === "subagent"
        ? updateDelegateTaskCard(claim, {
            response: {
              kind: "failed",
              summary:
                error instanceof Error ? error.message : "Delegate failed.",
              content: error instanceof Error ? error.message : String(error),
              request: null
            },
            expectedParentReply: "none"
          })
        : null;
    const failedClaim = await input.taskManager.failTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      errorSummary: error instanceof Error ? error.message : String(error),
      ...(taskCard ? { taskCard } : {})
    });
    if (claim.task.kind === "subagent") {
      await notifySubagentParent({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: failedClaim.task,
        kind: "delegate_failed",
        fallbackSummary: "后台子任务失败。",
        fallbackContent: error instanceof Error ? error.message : String(error)
      });
    } else if (claim.task.kind === "session_wakeup") {
      await notifyWakeupSession({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: failedClaim.task,
        kind: "delegate_failed",
        summary: "主会话后台续跑失败。",
        content: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    await runtimeHandle.dispose();
  }
}
