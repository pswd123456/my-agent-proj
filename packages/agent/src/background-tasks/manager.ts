import type { BackgroundTaskManager, EnqueueBackgroundTaskInput } from "./contracts.js";

import {
  type BackgroundTaskPayload,
  normalizeCapabilityPacks,
  sanitizeSessionMaxTurns
} from "@ai-app-template/domain";
import type { BackgroundTaskRepository } from "@ai-app-template/db";

import type { SessionManager } from "../session/contracts.js";

export interface BackgroundTaskManagerOptions {
  sessionManager: SessionManager;
  repository: BackgroundTaskRepository;
}

export class DefaultBackgroundTaskManager implements BackgroundTaskManager {
  constructor(private readonly options: BackgroundTaskManagerOptions) {}

  async enqueueTask(input: EnqueueBackgroundTaskInput) {
    const maxTurns = sanitizeSessionMaxTurns(
      input.maxTurns ?? input.sessionSeed?.maxTurns
    );
    const enabledCapabilityPacks = normalizeCapabilityPacks(
      input.enabledCapabilityPacks ?? input.sessionSeed?.enabledCapabilityPacks
    );
    const createSessionInput = {
      ...(input.sessionSeed ?? {}),
      workingDirectory: input.workingDirectory,
      model: input.model,
      maxTurns,
      enabledCapabilityPacks,
      ...(typeof input.userId === "string" ? { userId: input.userId } : {})
    };

    const childSession = await this.options.sessionManager.createSession(
      createSessionInput
    );

    const payload: BackgroundTaskPayload = {
      executor: "agent_session",
      message: input.message,
      workingDirectory: input.workingDirectory,
      model: input.model,
      maxTurns,
      ...(typeof input.permissionReply === "boolean"
        ? { permissionReply: input.permissionReply }
        : {}),
      enabledCapabilityPacks,
      metadata: structuredClone(input.metadata ?? {})
    };

    try {
      return await this.options.repository.enqueueTask({
        kind: input.kind,
        parentSessionId: input.parentSessionId ?? null,
        childSessionId: childSession.sessionId,
        payload,
        taskCard: input.taskCard ?? null
      });
    } catch (error) {
      await this.options.sessionManager.deleteSession(childSession.sessionId);
      throw error;
    }
  }

  async claimNextTask(workerId: string) {
    return this.options.repository.claimNextTask(workerId);
  }

  async getTask(taskId: string) {
    return this.options.repository.getTask(taskId);
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
    taskCard?: import("@ai-app-template/domain").DelegateTaskCard | null;
  }) {
    return this.options.repository.markTaskWaitingForInput(input);
  }

  async markTaskWaitingForMainAgent(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskCard?: import("@ai-app-template/domain").DelegateTaskCard | null;
  }) {
    return this.options.repository.markTaskWaitingForMainAgent(input);
  }

  async completeTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    resultSummary?: string | null;
    taskCard?: import("@ai-app-template/domain").DelegateTaskCard | null;
  }) {
    return this.options.repository.completeTask(input);
  }

  async failTask(input: {
    taskId: string;
    runId: string;
    workerId: string;
    errorSummary: string;
    resultSummary?: string | null;
    taskCard?: import("@ai-app-template/domain").DelegateTaskCard | null;
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
    taskCard?: import("@ai-app-template/domain").DelegateTaskCard | null;
  }) {
    return this.options.repository.cancelTask(input);
  }

  async requeueTask(input: {
    taskId: string;
    payload?: BackgroundTaskPayload;
    taskCard?: import("@ai-app-template/domain").DelegateTaskCard | null;
    resultSummary?: string | null;
    lastError?: string | null;
  }) {
    return this.options.repository.requeueTask(input);
  }

  async requeueStaleClaims(staleBefore: string) {
    return this.options.repository.requeueStaleClaims(staleBefore);
  }
}

export function createBackgroundTaskManager(
  options: BackgroundTaskManagerOptions
): DefaultBackgroundTaskManager {
  return new DefaultBackgroundTaskManager(options);
}
