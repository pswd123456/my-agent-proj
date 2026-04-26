import type {
  BackgroundTaskClaim,
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
  if (typeof result.finalAnswer === "string" && result.finalAnswer.trim().length > 0) {
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
        ...(option.description ? { description: option.description } : {})
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

function buildDelegateMainAgentRequest(
  result: RunSessionResult
): {
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

export async function runBackgroundTask(
  input: RunBackgroundTaskInput
): Promise<void> {
  const { claim, workerId } = input;
  const session = await input.sessionManager.getSession(claim.task.childSessionId);

  if (!session) {
    await input.taskManager.failTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      errorSummary: `Child session not found: ${claim.task.childSessionId}`
    });
    return;
  }

  const runtimeHandle = await input.createRuntimeHandle(session);
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
            void input.sessionManager.requestInterrupt(claim.task.childSessionId);
          }
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, input.heartbeatIntervalMs);

    const result = (await runtimeHandle.runtime.run({
      sessionId: claim.task.childSessionId,
      message: claim.task.payload.message,
      maxTurns: claim.task.payload.maxTurns,
      ...(typeof claim.task.payload.permissionReply === "boolean"
        ? { permissionReply: claim.task.payload.permissionReply }
        : {})
    })) as RunSessionResult;

    const resultSummary = summarizeResult(result);
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
      await input.taskManager.cancelTask({
        taskId: claim.task.taskId,
        runId: claim.run.runId,
        workerId,
        resultSummary,
        ...(taskCard ? { taskCard } : {})
      });
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

        await input.taskManager.markTaskWaitingForMainAgent({
          taskId: claim.task.taskId,
          runId: claim.run.runId,
          workerId,
          resultSummary: taskCard?.latestResponse?.summary ?? resultSummary,
          ...(taskCard ? { taskCard } : {})
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
      await input.taskManager.failTask({
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
      return;
    }

    const taskCard =
      claim.task.kind === "subagent"
        ? updateDelegateTaskCard(claim, {
            response: {
              kind: "message",
              summary: resultSummary ?? "Delegate completed.",
              content: result.finalAnswer ?? resultSummary ?? "Delegate completed.",
              request: null
            },
            expectedParentReply: "none"
          })
        : null;
    await input.taskManager.completeTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      resultSummary,
      ...(taskCard ? { taskCard } : {})
    });
  } catch (error) {
    const taskCard =
      claim.task.kind === "subagent"
        ? updateDelegateTaskCard(claim, {
            response: {
              kind: "failed",
              summary:
                error instanceof Error ? error.message : "Delegate failed.",
              content:
                error instanceof Error ? error.message : String(error),
              request: null
            },
            expectedParentReply: "none"
          })
        : null;
    await input.taskManager.failTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      errorSummary: error instanceof Error ? error.message : String(error),
      ...(taskCard ? { taskCard } : {})
    });
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    await runtimeHandle.dispose();
  }
}
