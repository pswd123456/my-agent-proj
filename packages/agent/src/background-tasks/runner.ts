import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import type {
  AgentSessionBackgroundTaskPayload,
  BackgroundTaskResultEnvelope,
  BackgroundTaskClaim,
  BackgroundNotificationKind,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  DelegateExpectedParentReply,
  DelegateRequestEnvelope,
  DelegateResponseEnvelope,
  DelegateTaskState,
  PendingConfirmationPayload,
  PendingPermissionRequest,
  PendingUserQuestionPayload,
  ShellCommandResultEnvelope,
  ShellCommandTaskState
} from "@ai-app-template/domain";

import type { TraceManager } from "../trace.js";
import type { SessionManager } from "../session/contracts.js";
import type { RunSessionResult } from "../types.js";

import type {
  BackgroundTaskManager,
  BackgroundTaskRuntimeHandle
} from "./contracts.js";
import { enqueueBackgroundNotification } from "./notifications.js";
import {
  buildBackgroundTaskPollMetadata,
  parseBackgroundTaskPollMetadata
} from "./orchestration.js";
import { truncateText } from "../tools/workspace.js";
const exec = promisify(execCallback);
const SHELL_OUTPUT_STDOUT_LIMIT = 12_000;
const SHELL_OUTPUT_STDERR_LIMIT = 6_000;

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

function updateDelegateTaskState(
  claim: BackgroundTaskClaim,
  input: {
    response: DelegateResponseEnvelope;
    expectedParentReply: DelegateExpectedParentReply;
  }
): DelegateTaskState | null {
  if (!claim.task.taskState || claim.task.taskState.kind !== "delegate") {
    return null;
  }

  return {
    ...claim.task.taskState,
    latestResponse: input.response,
    expectedParentReply: input.expectedParentReply
  };
}

function updateShellCommandTaskState(
  claim: BackgroundTaskClaim,
  latestResult: ShellCommandResultEnvelope
): ShellCommandTaskState | null {
  if (!claim.task.taskState || claim.task.taskState.kind !== "shell_command") {
    return null;
  }

  return {
    ...claim.task.taskState,
    latestResult
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
  const summary =
    payload.questions.length === 1
      ? (payload.questions[0]?.questionText ?? "Need more input.")
      : `需要补充回答 ${payload.questions.length} 个问题`;

  return {
    kind: "user_question",
    summary,
    data: {
      questions: payload.questions.map((question) => ({
        questionText: question.questionText,
        options: question.options.map((option) => ({
          label: option.label,
          reply: option.reply,
          ...(option.description ? { description: option.description } : {}),
          ...(option.isRecommended ? { isRecommended: true } : {})
        })),
        allowCancel: question.allowCancel !== false
      }))
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

function requireAgentSessionPayload(
  task: BackgroundTaskRecord
): AgentSessionBackgroundTaskPayload {
  if (task.payload.executor !== "agent_session") {
    throw new Error(
      `Expected agent_session payload for task ${task.taskId}, received ${task.payload.executor}.`
    );
  }

  return task.payload;
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

function isActiveBackgroundTaskStatus(status: BackgroundTaskStatus): boolean {
  return (
    status === "queued" ||
    status === "claimed" ||
    status === "running" ||
    status === "cancelling"
  );
}

async function maybeHandleBackgroundTaskPollWakeup(input: {
  claim: BackgroundTaskClaim;
  workerId: string;
  taskManager: BackgroundTaskManager;
}): Promise<boolean> {
  if (input.claim.task.kind !== "session_wakeup") {
    return false;
  }

  const poll = parseBackgroundTaskPollMetadata(input.claim.task);
  if (!poll) {
    return false;
  }

  const tasks = await Promise.all(
    poll.taskIds.map((taskId) => input.taskManager.getTask(taskId))
  );
  const activeTaskIds = tasks
    .filter(
      (task): task is BackgroundTaskRecord =>
        !!task && isActiveBackgroundTaskStatus(task.status)
    )
    .map((task) => task.taskId);

  if (activeTaskIds.length === 0) {
    return false;
  }

  const completedClaim = await input.taskManager.completeTask({
    taskId: input.claim.task.taskId,
    runId: input.claim.run.runId,
    workerId: input.workerId,
    resultSummary: "Background task poll found active work."
  });
  const nextIntervalMs = Math.min(poll.nextIntervalMs * 2, 120_000);
  const payload = requireAgentSessionPayload(completedClaim.task);
  await input.taskManager.requeueTask({
    taskId: completedClaim.task.taskId,
    payload: {
      ...payload,
      message: "",
      permissionReply: false,
      metadata: buildBackgroundTaskPollMetadata({
        taskIds: activeTaskIds,
        nextIntervalMs
      })
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
  const taskState =
    input.task.taskState?.kind === "delegate" ? input.task.taskState : null;
  const latestResponse = taskState?.latestResponse;
  await enqueueBackgroundNotification({
    sessionManager: input.sessionManager,
    traceManager: input.traceManager,
    taskManager: input.taskManager,
    task: input.task,
    kind: input.kind,
    summary: latestResponse?.summary ?? input.fallbackSummary,
    content: latestResponse?.content ?? input.fallbackContent,
    expectedParentReply: taskState?.expectedParentReply ?? "none",
    request: latestResponse?.request ?? null,
    result: latestResponse
      ? {
          type: "delegate",
          summary: latestResponse.summary,
          content: latestResponse.content,
          responseKind: latestResponse.kind,
          expectedParentReply: taskState?.expectedParentReply ?? "none",
          ...(latestResponse.request ? { request: latestResponse.request } : {})
        }
      : null,
    decrementActiveTaskCount: true
  });
}

async function notifyShellTaskParent(input: {
  sessionManager: SessionManager;
  traceManager?: TraceManager | undefined;
  taskManager: BackgroundTaskManager;
  task: BackgroundTaskRecord;
  kind: BackgroundNotificationKind;
  fallbackSummary: string;
  fallbackContent: string;
}): Promise<void> {
  const result =
    input.task.taskState?.kind === "shell_command"
      ? input.task.taskState.latestResult
      : null;
  await enqueueBackgroundNotification({
    sessionManager: input.sessionManager,
    traceManager: input.traceManager,
    taskManager: input.taskManager,
    task: input.task,
    kind: input.kind,
    summary: input.fallbackSummary,
    content: input.fallbackContent,
    expectedParentReply: "none",
    result,
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

function createShellCommandResult(input: {
  command: string;
  stdout: string;
  stderr: string;
  workingDirectory: string;
  timeoutMs: number;
  exitCode: number | null;
  terminationReason: ShellCommandResultEnvelope["terminationReason"];
}): ShellCommandResultEnvelope {
  return {
    type: "shell_command",
    command: input.command,
    stdout: truncateText(input.stdout, SHELL_OUTPUT_STDOUT_LIMIT),
    stderr: truncateText(input.stderr, SHELL_OUTPUT_STDERR_LIMIT),
    workingDirectory: input.workingDirectory,
    timeoutMs: input.timeoutMs,
    exitCode: input.exitCode,
    terminationReason: input.terminationReason
  };
}

function renderShellResultContent(result: ShellCommandResultEnvelope): string {
  const lines = [
    `command: ${result.command}`,
    `termination: ${result.terminationReason}`,
    `cwd: ${result.workingDirectory}`
  ];

  if (result.stdout.trim().length > 0) {
    lines.push(`stdout:\n${result.stdout}`);
  }
  if (result.stderr.trim().length > 0) {
    lines.push(`stderr:\n${result.stderr}`);
  }

  return lines.join("\n");
}

async function runShellCommandTask(
  input: RunBackgroundTaskInput
): Promise<void> {
  const { claim, workerId } = input;
  if (claim.task.payload.executor !== "shell_command") {
    throw new Error("Expected shell_command payload.");
  }

  const payload = claim.task.payload;
  await input.taskManager.markTaskRunning({
    taskId: claim.task.taskId,
    runId: claim.run.runId,
    workerId
  });

  const abortController = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let heartbeatInFlight = false;
  let cancelRequested = false;
  let deadlineExceeded = false;

  try {
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
            !cancelRequested
          ) {
            cancelRequested = true;
            abortController.abort();
          }
          if (
            heartbeatClaim?.task &&
            hasTaskExpired(heartbeatClaim.task) &&
            !deadlineExceeded
          ) {
            deadlineExceeded = true;
            abortController.abort();
          }
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, input.heartbeatIntervalMs);

    const { stdout, stderr } = await exec(payload.command, {
      cwd: payload.workingDirectory,
      signal: abortController.signal,
      timeout: payload.timeoutMs,
      maxBuffer: 512 * 1024
    });

    const latestResult = createShellCommandResult({
      command: payload.command,
      stdout,
      stderr,
      workingDirectory: payload.workingDirectory,
      timeoutMs: payload.timeoutMs,
      exitCode: 0,
      terminationReason: "completed"
    });
    const taskState = updateShellCommandTaskState(claim, latestResult);
    const completedClaim = await input.taskManager.completeTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      resultSummary: `${payload.command} (completed)`,
      ...(taskState ? { taskState } : {})
    });
    await notifyShellTaskParent({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      taskManager: input.taskManager,
      task: completedClaim.task,
      kind: "task_completed",
      fallbackSummary: `后台任务已完成：${payload.command}`,
      fallbackContent: renderShellResultContent(latestResult)
    });
  } catch (error) {
    const shellError = error as NodeJS.ErrnoException & {
      code?: number | string;
      killed?: boolean;
      signal?: NodeJS.Signals;
      stdout?: string;
      stderr?: string;
    };

    if (cancelRequested || deadlineExceeded || abortController.signal.aborted) {
      const terminationReason = deadlineExceeded ? "timeout" : "cancelled";
      const latestResult = createShellCommandResult({
        command: payload.command,
        stdout: shellError.stdout ?? "",
        stderr: shellError.stderr ?? "",
        workingDirectory: payload.workingDirectory,
        timeoutMs: payload.timeoutMs,
        exitCode: typeof shellError.code === "number" ? shellError.code : null,
        terminationReason
      });
      const taskState = updateShellCommandTaskState(claim, latestResult);

      if (deadlineExceeded) {
        const failedClaim = await input.taskManager.failTask({
          taskId: claim.task.taskId,
          runId: claim.run.runId,
          workerId,
          errorSummary: "Background shell task exceeded its deadline.",
          resultSummary: `${payload.command} (timeout)`,
          ...(taskState ? { taskState } : {})
        });
        await notifyShellTaskParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: failedClaim.task,
          kind: "task_timeout",
          fallbackSummary: `后台任务超时：${payload.command}`,
          fallbackContent: renderShellResultContent(latestResult)
        });
      } else {
        const cancelledClaim = await input.taskManager.cancelTask({
          taskId: claim.task.taskId,
          runId: claim.run.runId,
          workerId,
          resultSummary: `${payload.command} (cancelled)`,
          ...(taskState ? { taskState } : {})
        });
        await notifyShellTaskParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: cancelledClaim.task,
          kind: "task_cancelled",
          fallbackSummary: `后台任务已取消：${payload.command}`,
          fallbackContent: renderShellResultContent(latestResult)
        });
      }
      return;
    }

    const latestResult = createShellCommandResult({
      command: payload.command,
      stdout: shellError.stdout ?? "",
      stderr: shellError.stderr ?? "",
      workingDirectory: payload.workingDirectory,
      timeoutMs: payload.timeoutMs,
      exitCode: typeof shellError.code === "number" ? shellError.code : null,
      terminationReason:
        shellError.killed && shellError.signal === "SIGTERM"
          ? "timeout"
          : "failed"
    });
    const taskState = updateShellCommandTaskState(claim, latestResult);
    const failedClaim = await input.taskManager.failTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      errorSummary: error instanceof Error ? error.message : String(error),
      resultSummary: `${payload.command} (${latestResult.terminationReason})`,
      ...(taskState ? { taskState } : {})
    });
    await notifyShellTaskParent({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      taskManager: input.taskManager,
      task: failedClaim.task,
      kind:
        latestResult.terminationReason === "timeout"
          ? "task_timeout"
          : "task_failed",
      fallbackSummary:
        latestResult.terminationReason === "timeout"
          ? `后台任务超时：${payload.command}`
          : `后台任务失败：${payload.command}`,
      fallbackContent: renderShellResultContent(latestResult)
    });
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

export async function runBackgroundTask(
  input: RunBackgroundTaskInput
): Promise<void> {
  const { claim, workerId } = input;

  if (claim.task.kind === "shell_command") {
    await runShellCommandTask(input);
    return;
  }

  if (
    claim.task.kind === "session_wakeup" &&
    (await maybeHandleBackgroundTaskPollWakeup({
      claim,
      workerId,
      taskManager: input.taskManager
    }))
  ) {
    return;
  }

  const childSessionId = claim.task.childSessionId;
  if (!childSessionId) {
    const failedClaim = await input.taskManager.failTask({
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      workerId,
      errorSummary:
        "Child session is required for agent_session background tasks."
    });
    if (claim.task.kind === "subagent") {
      await notifySubagentParent({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: failedClaim.task,
        kind: "task_failed",
        fallbackSummary: "后台子任务失败。",
        fallbackContent:
          "Child session is required for agent_session background tasks."
      });
    }
    return;
  }

  const initialSession = await input.sessionManager.getSession(childSessionId);

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
        kind: "task_failed",
        fallbackSummary: "后台子任务失败。",
        fallbackContent: `Child session not found: ${claim.task.childSessionId}`
      });
    }
    return;
  }

  if (claim.task.kind === "session_wakeup") {
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
        kind: "task_timeout",
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
        kind: "task_timeout",
        summary: "主会话后台续跑超时。",
        content:
          "Background task exceeded its deadline before execution started."
      });
    }
    return;
  }

  const sessionPayload = requireAgentSessionPayload(claim.task);
  const runtimeHandle = await input.createRuntimeHandle(initialSession);
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let heartbeatInFlight = false;
  let interruptRequested = false;

  try {
    if (runtimeHandle.preRunTraceEvent && input.traceManager) {
      await input.traceManager.appendEvent(
        childSessionId,
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
            void input.sessionManager.requestInterrupt(childSessionId);
          }
          if (
            heartbeatClaim?.task &&
            hasTaskExpired(heartbeatClaim.task) &&
            !interruptRequested
          ) {
            interruptRequested = true;
            void input.sessionManager.requestInterrupt(childSessionId);
          }
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, input.heartbeatIntervalMs);

    const resultInput = {
      sessionId: childSessionId,
      maxTurns: sessionPayload.maxTurns,
      ...(sessionPayload.message.trim().length > 0
        ? { message: sessionPayload.message }
        : {}),
      ...(typeof sessionPayload.permissionReply === "boolean"
        ? { permissionReply: sessionPayload.permissionReply }
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
          kind: "task_timeout",
          fallbackSummary: "后台子任务超时。",
          fallbackContent: "Background task exceeded its deadline."
        });
      } else if (claim.task.kind === "session_wakeup") {
        await notifyWakeupSession({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: timedOutClaim.task,
          kind: "task_timeout",
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
      const taskState = updateDelegateTaskState(claim, {
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
        ...(taskState ? { taskState } : {})
      });
      if (claim.task.kind === "subagent") {
        await notifySubagentParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: cancelledClaim.task,
          kind: "task_cancelled",
          fallbackSummary: "后台子任务已取消。",
          fallbackContent: resultSummary ?? "Delegate cancelled."
        });
      }
      return;
    }

    if (isHumanInputPause(result)) {
      if (claim.task.kind === "subagent") {
        const request = buildDelegateMainAgentRequest(result);
        const taskState =
          request &&
          updateDelegateTaskState(claim, {
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
            resultSummary: taskState?.latestResponse?.summary ?? resultSummary,
            ...(taskState ? { taskState } : {})
          });
        await notifySubagentParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: waitingClaim.task,
          kind: "task_waiting",
          fallbackSummary:
            taskState?.latestResponse?.summary ?? "后台子任务需要主代理处理。",
          fallbackContent:
            taskState?.latestResponse?.content ??
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
      const taskState =
        claim.task.kind === "subagent"
          ? updateDelegateTaskState(claim, {
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
        ...(taskState ? { taskState } : {})
      });
      if (claim.task.kind === "subagent") {
        await notifySubagentParent({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          taskManager: input.taskManager,
          task: failedClaim.task,
          kind: "task_failed",
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
          kind: "task_failed",
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

    const taskState =
      claim.task.kind === "subagent"
        ? updateDelegateTaskState(claim, {
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
      ...(taskState ? { taskState } : {})
    });
    if (claim.task.kind === "subagent") {
      await notifySubagentParent({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: completedClaim.task,
        kind: "task_completed",
        fallbackSummary: "后台子任务已完成。",
        fallbackContent:
          result.finalAnswer ?? resultSummary ?? "Delegate completed."
      });
    }
  } catch (error) {
    const taskState =
      claim.task.kind === "subagent"
        ? updateDelegateTaskState(claim, {
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
      ...(taskState ? { taskState } : {})
    });
    if (claim.task.kind === "subagent") {
      await notifySubagentParent({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: failedClaim.task,
        kind: "task_failed",
        fallbackSummary: "后台子任务失败。",
        fallbackContent: error instanceof Error ? error.message : String(error)
      });
    } else if (claim.task.kind === "session_wakeup") {
      await notifyWakeupSession({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        taskManager: input.taskManager,
        task: failedClaim.task,
        kind: "task_failed",
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
