import type {
  BackgroundTaskPayload,
  BackgroundTaskRecord,
  BackgroundTaskStatus,
  DelegateExpectedParentReply,
  DelegatePermissionDecision,
  DelegateResponseEnvelope,
  DelegateTaskCard,
  DomainJsonValue
} from "@ai-app-template/domain";

import type { BackgroundTaskManager } from "../background-tasks/contracts.js";
import { incrementSessionBackgroundTaskCount } from "../background-tasks/notifications.js";
import type { SessionManager } from "../session/contracts.js";

export interface DelegateAgentView {
  delegateId: string;
  status: BackgroundTaskStatus;
  latestResponse: DelegateResponseEnvelope | null;
  expectedParentReply: DelegateExpectedParentReply;
  round: number;
}

export interface ScheduleDelegatePollInput {
  parentSessionId: string;
  delegateIds: string[];
  initialCheckAfterMs: number;
}

export interface StartDelegateInput {
  parentSessionId: string;
  title: string;
  objective: string;
  parentTaskSummary: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  message?: string;
}

export interface DelegateAgentService {
  startDelegate(input: StartDelegateInput): Promise<DelegateAgentView>;
  getDelegate(delegateId: string): Promise<DelegateAgentView>;
  replyToDelegate(
    delegateId: string,
    message: string
  ): Promise<DelegateAgentView>;
  resolveDelegatePermission(
    delegateId: string,
    decision: DelegatePermissionDecision
  ): Promise<DelegateAgentView>;
  scheduleDelegatePollWakeup(input: ScheduleDelegatePollInput): Promise<void>;
}

export interface DelegateAgentServiceOptions {
  sessionManager: SessionManager;
  taskManager: BackgroundTaskManager;
}

function trimNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return trimmed;
}

function toDelegateView(task: BackgroundTaskRecord): DelegateAgentView {
  const card = requireTaskCard(task);
  return {
    delegateId: task.taskId,
    status: task.status,
    latestResponse: structuredClone(card.latestResponse),
    expectedParentReply: card.expectedParentReply,
    round: card.currentRound
  };
}

function requireSubagentTask(
  task: BackgroundTaskRecord | null
): BackgroundTaskRecord {
  if (!task) {
    throw new Error("Delegate not found.");
  }
  if (task.kind !== "subagent") {
    throw new Error(`Task ${task.taskId} is not a delegate task.`);
  }
  return task;
}

function requireTaskCard(task: BackgroundTaskRecord): DelegateTaskCard {
  if (!task.taskCard) {
    throw new Error(`Delegate ${task.taskId} is missing its task card.`);
  }
  return task.taskCard;
}

function assertNotActive(task: BackgroundTaskRecord): void {
  if (
    task.status === "queued" ||
    task.status === "claimed" ||
    task.status === "running" ||
    task.status === "cancelling"
  ) {
    throw new Error(`Delegate ${task.taskId} is still active.`);
  }
}

function buildDelegateStartMessage(card: DelegateTaskCard): string {
  const lines = [
    "You are a delegated subagent working in an isolated child session.",
    "Do not assume you have access to the parent agent's hidden context.",
    "",
    `Title: ${card.title}`,
    `Objective: ${card.objective}`,
    `Parent task summary: ${card.parentTaskSummary}`
  ];

  if (card.acceptanceCriteria.length > 0) {
    lines.push("", "Acceptance criteria:");
    for (const item of card.acceptanceCriteria) {
      lines.push(`- ${item}`);
    }
  }

  if (card.constraints.length > 0) {
    lines.push("", "Constraints:");
    for (const item of card.constraints) {
      lines.push(`- ${item}`);
    }
  }

  if (card.latestParentMessage) {
    lines.push("", "Latest parent message:", card.latestParentMessage);
  }

  lines.push(
    "",
    "When you complete the task, respond concisely to the main agent.",
    "If you need more information or a permission decision, ask directly."
  );

  return lines.join("\n");
}

function buildInitialTaskCard(input: StartDelegateInput): DelegateTaskCard {
  return {
    title: trimNonEmpty(input.title, "title"),
    objective: trimNonEmpty(input.objective, "objective"),
    parentTaskSummary: trimNonEmpty(
      input.parentTaskSummary,
      "parentTaskSummary"
    ),
    acceptanceCriteria: (input.acceptanceCriteria ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    constraints: (input.constraints ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    currentRound: 1,
    latestParentMessage:
      typeof input.message === "string" && input.message.trim().length > 0
        ? input.message.trim()
        : null,
    latestResponse: null,
    expectedParentReply: "none",
    contextInheritance: "shell_only",
    responseIsolation: true
  };
}

function buildNextPayload(
  task: BackgroundTaskRecord,
  input: {
    message: string;
    permissionReply?: boolean;
  }
): BackgroundTaskPayload {
  return {
    ...task.payload,
    message: input.message,
    permissionReply: input.permissionReply ?? false
  };
}

function buildNextCard(
  card: DelegateTaskCard,
  latestParentMessage: string
): DelegateTaskCard {
  return {
    ...card,
    currentRound: card.currentRound + 1,
    latestParentMessage,
    expectedParentReply: "none"
  };
}

function isActiveWakeupStatus(status: BackgroundTaskStatus): boolean {
  return (
    status === "queued" ||
    status === "claimed" ||
    status === "running" ||
    status === "cancelling"
  );
}

function buildDelegatePollMetadata(input: {
  delegateIds: string[];
  nextIntervalMs: number;
}): Record<string, DomainJsonValue> {
  return {
    reason: "delegate_poll",
    delegateTaskIds: input.delegateIds,
    nextIntervalMs: input.nextIntervalMs
  };
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

export class DefaultDelegateAgentService implements DelegateAgentService {
  constructor(private readonly options: DelegateAgentServiceOptions) {}

  async startDelegate(input: StartDelegateInput): Promise<DelegateAgentView> {
    const parentSession = await this.options.sessionManager.getSession(
      input.parentSessionId
    );
    if (!parentSession) {
      throw new Error(`Parent session not found: ${input.parentSessionId}`);
    }

    const taskCard = buildInitialTaskCard(input);
    const task = await this.options.taskManager.enqueueTask({
      kind: "subagent",
      parentSessionId: parentSession.sessionId,
      workingDirectory: parentSession.workingDirectory,
      model: parentSession.model,
      userId: parentSession.context.userId,
      message: buildDelegateStartMessage(taskCard),
      taskCard
    });
    await incrementSessionBackgroundTaskCount({
      sessionManager: this.options.sessionManager,
      sessionId: parentSession.sessionId,
      delta: 1
    });
    return toDelegateView(task);
  }

  async getDelegate(delegateId: string): Promise<DelegateAgentView> {
    const task = requireSubagentTask(
      await this.options.taskManager.getTask(delegateId)
    );
    return toDelegateView(task);
  }

  async replyToDelegate(
    delegateId: string,
    message: string
  ): Promise<DelegateAgentView> {
    const task = requireSubagentTask(
      await this.options.taskManager.getTask(delegateId)
    );
    const latestParentMessage = trimNonEmpty(message, "message");
    assertNotActive(task);
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(
        `Delegate ${task.taskId} is ${task.status}. Start a new delegate instead.`
      );
    }

    const card = requireTaskCard(task);
    if (
      task.status === "waiting_for_main_agent" &&
      card.expectedParentReply === "permission_decision"
    ) {
      throw new Error(
        `Delegate ${task.taskId} is waiting for a permission decision.`
      );
    }

    const nextTask = await this.options.taskManager.requeueTask({
      taskId: task.taskId,
      payload: buildNextPayload(task, { message: latestParentMessage }),
      taskCard: buildNextCard(card, latestParentMessage),
      lastError: null
    });
    await incrementSessionBackgroundTaskCount({
      sessionManager: this.options.sessionManager,
      sessionId: task.parentSessionId!,
      delta: 1
    });
    return toDelegateView(nextTask);
  }

  async resolveDelegatePermission(
    delegateId: string,
    decision: DelegatePermissionDecision
  ): Promise<DelegateAgentView> {
    const task = requireSubagentTask(
      await this.options.taskManager.getTask(delegateId)
    );
    assertNotActive(task);
    const card = requireTaskCard(task);
    if (task.status !== "waiting_for_main_agent") {
      throw new Error(
        `Delegate ${task.taskId} is not waiting for a parent decision.`
      );
    }
    if (card.expectedParentReply !== "permission_decision") {
      throw new Error(
        `Delegate ${task.taskId} is not waiting for a permission decision.`
      );
    }

    const approved = decision === "approve";
    const parentMessage = approved
      ? "Approved the pending permission request."
      : "Rejected the pending permission request.";
    const nextTask = await this.options.taskManager.requeueTask({
      taskId: task.taskId,
      payload: buildNextPayload(task, {
        message: approved ? "yes" : "no",
        permissionReply: true
      }),
      taskCard: buildNextCard(card, parentMessage),
      lastError: null
    });
    await incrementSessionBackgroundTaskCount({
      sessionManager: this.options.sessionManager,
      sessionId: task.parentSessionId!,
      delta: 1
    });
    return toDelegateView(nextTask);
  }

  async scheduleDelegatePollWakeup(
    input: ScheduleDelegatePollInput
  ): Promise<void> {
    const delegateIds = [...new Set(input.delegateIds.filter(Boolean))];
    if (delegateIds.length === 0) {
      return;
    }

    const parentSession = await this.options.sessionManager.getSession(
      input.parentSessionId
    );
    if (!parentSession) {
      return;
    }

    const intervalMs = Math.max(
      1_000,
      Math.min(120_000, Math.floor(input.initialCheckAfterMs))
    );
    const availableAt = new Date(Date.now() + intervalMs).toISOString();
    const existingWakeup =
      await this.options.taskManager.getWakeupTaskBySessionId(
        parentSession.sessionId
      );
    const metadata = buildDelegatePollMetadata({
      delegateIds,
      nextIntervalMs: intervalMs
    });

    if (existingWakeup && isActiveWakeupStatus(existingWakeup.status)) {
      if (
        existingWakeup.status === "queued" &&
        shouldMoveWakeupEarlier({
          currentAvailableAt: existingWakeup.availableAt,
          nextAvailableAt: availableAt
        })
      ) {
        await this.options.taskManager.rescheduleQueuedTask({
          taskId: existingWakeup.taskId,
          payload: {
            ...existingWakeup.payload,
            message: "",
            permissionReply: false,
            metadata
          },
          availableAt,
          resultSummary: null,
          lastError: null
        });
      }
      return;
    }

    if (existingWakeup) {
      await this.options.taskManager.requeueTask({
        taskId: existingWakeup.taskId,
        payload: {
          ...existingWakeup.payload,
          message: "",
          permissionReply: false,
          metadata
        },
        availableAt,
        resultSummary: null,
        lastError: null,
        maxAttempts: 1
      });
      return;
    }

    await this.options.taskManager.enqueueTask({
      kind: "session_wakeup",
      parentSessionId: parentSession.sessionId,
      childSessionId: parentSession.sessionId,
      message: "",
      workingDirectory: parentSession.workingDirectory,
      model: parentSession.model,
      maxTurns: Math.min(parentSession.maxTurns, 8),
      userId: parentSession.context.userId,
      enabledCapabilityPacks: parentSession.context.enabledCapabilityPacks,
      metadata,
      availableAt,
      maxAttempts: 1
    });
  }
}

export function createDelegateAgentService(
  options: DelegateAgentServiceOptions
): DefaultDelegateAgentService {
  return new DefaultDelegateAgentService(options);
}
