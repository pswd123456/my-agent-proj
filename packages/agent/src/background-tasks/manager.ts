import type { BackgroundTaskManager, EnqueueBackgroundTaskInput } from "./contracts.js";

import {
  type BackgroundTaskExecutor,
  type BackgroundTaskPayload,
  type BackgroundTaskState,
  normalizeCapabilityPacks,
  sanitizeSessionMaxTurns
} from "@ai-app-template/domain";
import type { BackgroundTaskRepository } from "@ai-app-template/db";

import type { SessionManager } from "../session/contracts.js";

function resolveDefaultDeadline(input: {
  kind: EnqueueBackgroundTaskInput["kind"];
  now?: number;
}): string {
  const base = input.now ?? Date.now();
  const durationMs = input.kind === "session_wakeup" ? 2 * 60_000 : 10 * 60_000;
  return new Date(base + durationMs).toISOString();
}

export interface BackgroundTaskManagerOptions {
  sessionManager: SessionManager;
  repository: BackgroundTaskRepository;
}

export class DefaultBackgroundTaskManager implements BackgroundTaskManager {
  constructor(private readonly options: BackgroundTaskManagerOptions) {}

  async enqueueTask(input: EnqueueBackgroundTaskInput) {
    const executor: BackgroundTaskExecutor = input.executor ?? "agent_session";
    const maxTurns = sanitizeSessionMaxTurns(
      input.maxTurns ?? input.sessionSeed?.maxTurns
    );
    const enabledCapabilityPacks = normalizeCapabilityPacks(
      input.enabledCapabilityPacks ?? input.sessionSeed?.enabledCapabilityPacks
    );
    const existingChildSessionId = input.childSessionId?.trim() || null;
    const shouldCreateChildSession = executor === "agent_session";
    const childSession = shouldCreateChildSession
      ? existingChildSessionId
        ? await this.options.sessionManager.getSession(existingChildSessionId)
        : await this.options.sessionManager.createSession({
            ...(input.sessionSeed ?? {}),
            workingDirectory: input.workingDirectory,
            model: input.model,
            maxTurns,
            enabledCapabilityPacks,
            ...(typeof input.userId === "string" ? { userId: input.userId } : {})
          })
      : null;

    if (shouldCreateChildSession && !childSession) {
      throw new Error(
        `Child session not found for background task: ${existingChildSessionId}`
      );
    }

    const sharedPayload = {
      message: input.message,
      workingDirectory: input.workingDirectory,
      model: input.model,
      maxTurns,
      enabledCapabilityPacks,
      metadata: structuredClone(input.metadata ?? {})
    };
    const payload: BackgroundTaskPayload =
      executor === "shell_command"
        ? {
            executor,
            ...sharedPayload,
            command: input.command?.trim() ?? "",
            timeoutMs:
              typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
                ? Math.max(1, Math.floor(input.timeoutMs))
                : 120_000
          }
        : {
            executor,
            ...sharedPayload,
            ...(typeof input.permissionReply === "boolean"
              ? { permissionReply: input.permissionReply }
              : {})
          };

    if (payload.executor === "shell_command" && payload.command.length === 0) {
      throw new Error("shell_command background tasks require a command.");
    }

    try {
      return await this.options.repository.enqueueTask({
        kind: input.kind,
        parentSessionId: input.parentSessionId ?? null,
        childSessionId: childSession?.sessionId ?? null,
        payload,
        taskState: input.taskState ?? null,
        availableAt: input.availableAt ?? null,
        deadlineAt: input.deadlineAt ?? resolveDefaultDeadline({ kind: input.kind }),
        maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? 1))
      });
    } catch (error) {
      if (shouldCreateChildSession && !existingChildSessionId && childSession) {
        await this.options.sessionManager.deleteSession(childSession.sessionId);
      }
      throw error;
    }
  }

  async claimNextTask(workerId: string) {
    return this.options.repository.claimNextTask(workerId);
  }

  async getTask(taskId: string) {
    return this.options.repository.getTask(taskId);
  }

  async getWakeupTaskBySessionId(sessionId: string) {
    return this.options.repository.getWakeupTaskBySessionId(sessionId);
  }

  async rescheduleQueuedTask(input: {
    taskId: string;
    payload?: BackgroundTaskPayload;
    resultSummary?: string | null;
    lastError?: string | null;
    availableAt?: string | null;
    deadlineAt?: string | null;
  }) {
    return this.options.repository.rescheduleQueuedTask(input);
  }

  async heartbeatTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
  }) {
    return this.options.repository.heartbeatTask(input);
  }

  async markTaskRunning(input: {
    taskId: string;
    runId: string;
    workerId: string;
  }) {
    return this.options.repository.markTaskRunning(input);
  }

  async markTaskWaitingForInput(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }) {
    return this.options.repository.markTaskWaitingForInput(input);
  }

  async markTaskWaitingForMainAgent(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }) {
    return this.options.repository.markTaskWaitingForMainAgent(input);
  }

  async completeTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }) {
    return this.options.repository.completeTask(input);
  }

  async failTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    errorSummary: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }) {
    return this.options.repository.failTask(input);
  }

  async requestCancel(taskId: string) {
    return this.options.repository.requestCancel(taskId);
  }

  async cancelTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskState?: BackgroundTaskState | null;
  }) {
    return this.options.repository.cancelTask(input);
  }

  async requeueTask(input: {
    taskId: string;
    payload?: BackgroundTaskPayload;
    taskState?: BackgroundTaskState | null;
    resultSummary?: string | null;
    lastError?: string | null;
    availableAt?: string | null;
    deadlineAt?: string | null;
    maxAttempts?: number;
  }) {
    return this.options.repository.requeueTask({
      ...input,
      availableAt: input.availableAt ?? null,
      deadlineAt:
        input.deadlineAt ??
        resolveDefaultDeadline({
          kind:
            (await this.options.repository.getTask(input.taskId))?.kind ??
            "subagent"
        })
    });
  }

  async requeueStaleClaims(staleBefore: string) {
    return this.options.repository.requeueStaleClaims(staleBefore);
  }

  async listTasksByParentSession(parentSessionId: string) {
    const tasks = await this.options.repository.listTasks();
    return tasks.filter((task) => task.parentSessionId === parentSessionId);
  }
}

export function createBackgroundTaskManager(
  options: BackgroundTaskManagerOptions
): DefaultBackgroundTaskManager {
  return new DefaultBackgroundTaskManager(options);
}
