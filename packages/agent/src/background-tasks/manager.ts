import type { BackgroundTaskManager, EnqueueBackgroundTaskInput } from "./contracts.js";

import {
  type BackgroundTaskExecutor,
  type BackgroundTaskPayload,
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

function resolveParentRelationKind(input: {
  kind: EnqueueBackgroundTaskInput["kind"];
  parentSessionId?: string | null;
}): "subagent" | "hook_subagent" | null {
  if (!input.parentSessionId) {
    return null;
  }

  if (input.kind === "subagent") {
    return "subagent";
  }

  if (input.kind === "hook_subagent") {
    return "hook_subagent";
  }

  return null;
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
    const parentRelationKind = resolveParentRelationKind({
      kind: input.kind,
      parentSessionId: input.parentSessionId ?? null
    });
    const shouldCreateChildSession = executor === "agent_session";
    let childSession = shouldCreateChildSession
      ? existingChildSessionId
        ? await this.options.sessionManager.getSession(existingChildSessionId)
        : await this.options.sessionManager.createSession({
            ...(input.sessionSeed ?? {}),
            ...(parentRelationKind
              ? {
                  parentSessionId: input.parentSessionId ?? null,
                  parentRelationKind
                }
              : {}),
            workingDirectory: input.workingDirectory,
            model: input.model,
            maxTurns,
            enabledCapabilityPacks
          })
      : null;

    if (shouldCreateChildSession && !childSession) {
      throw new Error(
        `Child session not found for background task: ${existingChildSessionId}`
      );
    }

    if (
      childSession &&
      parentRelationKind &&
      (childSession.parentSessionId !== input.parentSessionId ||
        childSession.parentRelationKind !== parentRelationKind)
    ) {
      childSession = await this.options.sessionManager.saveSession({
        ...childSession,
        parentSessionId: input.parentSessionId ?? null,
        parentRelationKind
      });
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

  claimNextTask: BackgroundTaskRepository["claimNextTask"] = (workerId) => {
    return this.options.repository.claimNextTask(workerId);
  };

  getTask: BackgroundTaskRepository["getTask"] = (taskId) => {
    return this.options.repository.getTask(taskId);
  };

  getWakeupTaskBySessionId: BackgroundTaskRepository["getWakeupTaskBySessionId"] = (
    sessionId
  ) => {
    return this.options.repository.getWakeupTaskBySessionId(sessionId);
  };

  rescheduleQueuedTask: BackgroundTaskRepository["rescheduleQueuedTask"] = (
    input
  ) => {
    return this.options.repository.rescheduleQueuedTask(input);
  };

  heartbeatTask: BackgroundTaskRepository["heartbeatTask"] = (input) => {
    return this.options.repository.heartbeatTask(input);
  };

  markTaskRunning: BackgroundTaskRepository["markTaskRunning"] = (input) => {
    return this.options.repository.markTaskRunning(input);
  };

  markTaskWaitingForInput: BackgroundTaskRepository["markTaskWaitingForInput"] = (
    input
  ) => {
    return this.options.repository.markTaskWaitingForInput(input);
  };

  markTaskWaitingForMainAgent: BackgroundTaskRepository["markTaskWaitingForMainAgent"] = (
    input
  ) => {
    return this.options.repository.markTaskWaitingForMainAgent(input);
  };

  completeTask: BackgroundTaskRepository["completeTask"] = (input) => {
    return this.options.repository.completeTask(input);
  };

  failTask: BackgroundTaskRepository["failTask"] = (input) => {
    return this.options.repository.failTask(input);
  };

  requestCancel: BackgroundTaskRepository["requestCancel"] = (taskId) => {
    return this.options.repository.requestCancel(taskId);
  };

  cancelTask: BackgroundTaskRepository["cancelTask"] = (input) => {
    return this.options.repository.cancelTask(input);
  };

  async requeueTask(
    input: Parameters<BackgroundTaskRepository["requeueTask"]>[0]
  ) {
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

  requeueStaleClaims: BackgroundTaskRepository["requeueStaleClaims"] = (
    staleBefore
  ) => {
    return this.options.repository.requeueStaleClaims(staleBefore);
  };

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
