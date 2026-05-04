import { randomUUID } from "node:crypto";

import {
  createLogger,
  type Logger,
  type SystemLogManager
} from "./system-log.js";

import type { CronJobRepository, RoutineRepository } from "@ai-app-template/db";
import {
  DEFAULT_SESSION_MODEL,
  normalizeUserContextHookMaxTurns,
  normalizeThinkingEffort,
  type UserContextHookRecord,
  type WorkspaceSkillSettingRecord
} from "@ai-app-template/domain";

import type {
  AnthropicCompatibleClient,
  AnthropicMessage,
  AnthropicToolChoice
} from "./model.js";
import type { ModelService } from "./models/index.js";
import {
  createPromptBuilder,
  toAnthropicMessages,
  type PromptBuilder
} from "./prompt.js";
import type {
  ConversationBlock,
  RunSessionInput,
  RunSessionResult,
  SessionSnapshot,
  UserConversationBlock
} from "./types.js";
import type { SessionManager } from "./session.js";
import type { ToolRegistry } from "./tools/registry.js";
import { createRunCompleteEvent, type RunEventSink } from "./events.js";
import type { DelegateAgentService } from "./delegation/index.js";
import type { BackgroundTaskManager } from "./background-tasks/index.js";
import { runSessionLoop } from "./runtime/run-loop.js";
import { completeLocally } from "./runtime/complete-run.js";
import { buildHookUserBlockContent } from "./runtime/blocks.js";
import { DEFAULT_EXECUTION_LEASE_TIMEOUT_MS } from "./session/contracts.js";
import { resolveUserContextMessageHooks } from "./context-hooks.js";
import { incrementSessionBackgroundTaskCount } from "./background-tasks/notifications.js";
import { scheduleBackgroundTaskPollWakeup } from "./background-tasks/orchestration.js";
import {
  getUserContextHookConfigHash,
  isSubagentUserContextHook,
  resolveSubagentHookWaitMode
} from "./subagent-hooks.js";
import { createRunScopedTraceManager, type TraceManager } from "./trace.js";

export interface AgentRuntimeOptions {
  systemLogManager?: SystemLogManager;
  runtimeLogger?: Logger;
  client?: AnthropicCompatibleClient;
  model?: string;
  modelService?: ModelService;
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  cronJobRepository?: CronJobRepository;
  toolRegistry: ToolRegistry;
  delegateAgentService?: DelegateAgentService;
  backgroundTaskManager?: BackgroundTaskManager;
  traceManager?: TraceManager;
  promptBuilder?: PromptBuilder;
  userContextHooks?: UserContextHookRecord[];
  workspaceSkillSettings?: WorkspaceSkillSettingRecord[];
  userCustomPrompt?: string;
  maxTurns?: number;
  maxTokens?: number;
  toolChoice?: AnthropicToolChoice;
  eventSink?: RunEventSink;
  executionLeaseTimeoutMs?: number;
}

export class SessionExecutionInProgressError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session is already running: ${sessionId}`);
    this.name = "SessionExecutionInProgressError";
  }
}

export class AgentRuntime {
  private readonly promptBuilder: PromptBuilder;
  private readonly runtimeLogger: Logger | undefined;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.promptBuilder = options.promptBuilder ?? createPromptBuilder();
    this.runtimeLogger = options.runtimeLogger;
  }

  private resolveDefaultModel(): string {
    return (
      this.options.modelService?.getDefaultModel() ??
      this.options.model ??
      DEFAULT_SESSION_MODEL
    );
  }

  private resolveClient(model: string): AnthropicCompatibleClient {
    if (this.options.modelService) {
      return this.options.modelService.getClient(model);
    }

    if (!this.options.client) {
      throw new Error("Model client is not configured.");
    }

    return this.options.client;
  }

  private sanitizeMessagesForModel(
    model: string,
    messages: AnthropicMessage[]
  ): AnthropicMessage[] {
    if (this.options.modelService?.supportsThinking(model) ?? true) {
      return messages;
    }

    return messages
      .map((message) => ({
        ...message,
        content: message.content.filter((block) => block.type !== "thinking")
      }))
      .filter((message) => message.content.length > 0);
  }

  private resolveRequestOptions(session: SessionSnapshot) {
    const efforts =
      this.options.modelService?.getThinkingEfforts(session.model) ?? [];
    if (efforts.length === 0) {
      return undefined;
    }

    return {
      output_config: {
        effort: normalizeThinkingEffort(session.context.thinkingEffort)
      }
    };
  }

  private shouldRunUserMessageHooks(session: SessionSnapshot): boolean {
    return (
      !session.context.pendingPermissionRequest &&
      !session.context.pendingConfirmationPayload &&
      !session.context.pendingUserQuestionPayload
    );
  }

  private resolvePreUserHookMessages(
    session: SessionSnapshot
  ): UserConversationBlock[] {
    if (!this.shouldRunUserMessageHooks(session)) {
      return [];
    }

    const hooks = this.options.userContextHooks ?? [];
    return [
      ...resolveUserContextMessageHooks({
        hooks,
        session,
        event: "session_started"
      }),
      ...resolveUserContextMessageHooks({
        hooks,
        session,
        event: "run_started"
      })
    ].map((hook) =>
      buildHookUserBlockContent({
        message: hook.content,
        hookEvent: hook.event,
        ...(hook.title.trim() ? { hookTitle: hook.title.trim() } : {})
      })
    );
  }

  private resolvePostUserHookMessages(
    session: SessionSnapshot
  ): UserConversationBlock[] {
    if (!this.shouldRunUserMessageHooks(session)) {
      return [];
    }

    return resolveUserContextMessageHooks({
      hooks: this.options.userContextHooks ?? [],
      session,
      event: "run_end"
    }).map((hook) =>
      buildHookUserBlockContent({
        message: hook.content,
        hookEvent: hook.event,
        ...(hook.title.trim() ? { hookTitle: hook.title.trim() } : {})
      })
    );
  }

  private shouldRunSubagentHooks(input: {
    session: SessionSnapshot;
    message: string | undefined;
    skipSubagentHooks?: boolean | undefined;
  }): boolean {
    return (
      typeof input.message === "string" &&
      input.message.trim().length > 0 &&
      input.skipSubagentHooks !== true &&
      Boolean(this.options.backgroundTaskManager) &&
      !input.session.context.pendingPermissionRequest &&
      !input.session.context.pendingConfirmationPayload &&
      !input.session.context.pendingUserQuestionPayload
    );
  }

  private buildHookSubagentTaskState(
    hook: UserContextHookRecord & {
      behavior: "subagent";
      waitMode: "blocking" | "unblocking";
    }
  ) {
    const waitMode = resolveSubagentHookWaitMode(hook);
    return {
      kind: "hook_subagent" as const,
      hookId: hook.id,
      hookEvent: hook.event,
      waitMode,
      title: hook.title.trim() || hook.id,
      configHash: getUserContextHookConfigHash(hook),
      latestResult: null
    };
  }

  private async enqueueSubagentHookTask(input: {
    session: SessionSnapshot;
    hook: UserContextHookRecord & {
      behavior: "subagent";
      waitMode: "blocking" | "unblocking";
    };
    traceManager?: TraceManager | undefined;
    resumeMessage?: string | undefined;
  }): Promise<{
    session: SessionSnapshot;
    taskId: string;
    waitMode: "blocking" | "unblocking";
  }> {
    const taskManager = this.options.backgroundTaskManager;
    if (!taskManager) {
      throw new Error(
        "Background task manager is required for subagent hooks."
      );
    }

    const configHash = getUserContextHookConfigHash(input.hook);
    const waitMode = resolveSubagentHookWaitMode(input.hook);
    const task = await taskManager.enqueueTask({
      kind: "hook_subagent",
      parentSessionId: input.session.sessionId,
      message: input.hook.content.trim(),
      workingDirectory: input.session.workingDirectory,
      model: input.session.model,
      maxTurns: normalizeUserContextHookMaxTurns(input.hook.maxTurns),
      userId: input.session.context.userId,
      enabledCapabilityPacks: input.session.context.enabledCapabilityPacks,
      metadata: {
        hookId: input.hook.id,
        hookEvent: input.hook.event,
        configHash,
        ...(waitMode === "blocking" && input.resumeMessage
          ? {
              resumeMessage: input.resumeMessage,
              skipSubagentHooks: true
            }
          : {})
      },
      taskState: this.buildHookSubagentTaskState(input.hook)
    });

    if (input.traceManager) {
      await input.traceManager.appendEvent(input.session.sessionId, {
        kind: "hook_subagent_scheduled",
        turnCount: Math.max(0, input.session.sessionState.turnCount),
        taskId: task.taskId,
        hookId: input.hook.id,
        hookEvent: input.hook.event,
        waitMode,
        configHash
      });
    }

    await incrementSessionBackgroundTaskCount({
      sessionManager: this.options.sessionManager,
      sessionId: input.session.sessionId,
      delta: 1
    });

    return {
      session:
        (await this.options.sessionManager.getSession(
          input.session.sessionId
        )) ?? input.session,
      taskId: task.taskId,
      waitMode
    };
  }

  private async schedulePreRunSubagentHooks(input: {
    session: SessionSnapshot;
    message: string;
    traceManager?: TraceManager | undefined;
  }): Promise<{
    session: SessionSnapshot;
    blockingTaskIds: string[];
  }> {
    const taskManager = this.options.backgroundTaskManager;
    if (!taskManager) {
      return { session: input.session, blockingTaskIds: [] };
    }

    const allHooks = this.options.userContextHooks ?? [];
    const enabledHooks = allHooks.filter(isSubagentUserContextHook);
    if (enabledHooks.length === 0) {
      return { session: input.session, blockingTaskIds: [] };
    }

    const existingTasks = await taskManager.listTasksByParentSession(
      input.session.sessionId
    );
    const nextBlockingTaskIds: string[] = [];
    let session = input.session;

    for (const hook of enabledHooks) {
      if (hook.event === "run_end") {
        continue;
      }

      if (
        hook.event === "session_started" &&
        Math.max(0, input.session.sessionState.turnCount) !== 0
      ) {
        continue;
      }

      const configHash = getUserContextHookConfigHash(hook);
      const hasMaterializedSessionStartResult =
        hook.event === "session_started" &&
        input.session.context.hookContextEntries.some(
          (entry) =>
            entry.hookEvent === "session_started" &&
            entry.hookId === hook.id &&
            entry.configHash === configHash
        );
      const hasPendingSessionStartResult =
        hook.event === "session_started" &&
        input.session.context.pendingBackgroundNotifications.some(
          (notification) =>
            notification.taskKind === "hook_subagent" &&
            notification.result?.type === "hook_subagent" &&
            notification.result.hookId === hook.id &&
            notification.result.configHash === configHash
        );
      const hasActiveSessionStartTask =
        hook.event === "session_started" &&
        existingTasks.some(
          (task) =>
            task.kind === "hook_subagent" &&
            (task.status === "queued" ||
              task.status === "claimed" ||
              task.status === "running" ||
              task.status === "cancelling") &&
            task.taskState?.kind === "hook_subagent" &&
            task.taskState.hookId === hook.id &&
            task.taskState.configHash === configHash
        );

      if (
        hook.event === "session_started" &&
        (hasMaterializedSessionStartResult ||
          hasPendingSessionStartResult ||
          hasActiveSessionStartTask)
      ) {
        continue;
      }

      const scheduled = await this.enqueueSubagentHookTask({
        session: input.session,
        hook,
        traceManager: input.traceManager,
        resumeMessage: input.message
      });
      if (scheduled.waitMode === "blocking") {
        nextBlockingTaskIds.push(scheduled.taskId);
      }
      session = scheduled.session;
    }

    return {
      session,
      blockingTaskIds: nextBlockingTaskIds
    };
  }

  private async schedulePostRunSubagentHooks(input: {
    session: SessionSnapshot;
    traceManager?: TraceManager | undefined;
  }): Promise<SessionSnapshot> {
    if (!this.options.backgroundTaskManager) {
      return input.session;
    }

    const hooks = (this.options.userContextHooks ?? []).filter(
      (
        hook
      ): hook is UserContextHookRecord & {
        behavior: "subagent";
        waitMode: "blocking" | "unblocking";
      } => isSubagentUserContextHook(hook) && hook.event === "run_end"
    );
    if (hooks.length === 0) {
      return input.session;
    }

    let session = input.session;
    for (const hook of hooks) {
      const scheduled = await this.enqueueSubagentHookTask({
        session,
        hook,
        traceManager: input.traceManager
      });
      session = scheduled.session;
    }

    return session;
  }

  async createSession(
    input: {
      parentSessionId?: string | null;
      parentRelationKind?: "fork" | "subagent" | "hook_subagent" | null;
      forkReplayCheckpointId?: string | null;
      workingDirectory?: string;
      model?: string;
      thinkingEffort?: ReturnType<typeof normalizeThinkingEffort>;
      userId?: string;
      yoloMode?: boolean;
      planModeEnabled?: boolean;
      contextWindow?: number;
      maxTurns?: number;
      shellAllowPatterns?: string[];
      shellDenyPatterns?: string[];
      toolAllowList?: string[];
      toolAskList?: string[];
      toolDenyList?: string[];
      enabledCapabilityPacks?: string[];
    } = {}
  ): ReturnType<SessionManager["createSession"]> {
    const createInput: {
      parentSessionId?: string | null;
      parentRelationKind?: "fork" | "subagent" | "hook_subagent" | null;
      forkReplayCheckpointId?: string | null;
      workingDirectory?: string;
      model?: string;
      thinkingEffort?: ReturnType<typeof normalizeThinkingEffort>;
      userId?: string;
      yoloMode?: boolean;
      planModeEnabled?: boolean;
      contextWindow?: number;
      maxTurns?: number;
      shellAllowPatterns?: string[];
      shellDenyPatterns?: string[];
      toolAllowList?: string[];
      toolAskList?: string[];
      toolDenyList?: string[];
      enabledCapabilityPacks?: string[];
    } = {
      model: input.model ?? this.resolveDefaultModel()
    };

    if (
      typeof input.parentSessionId === "string" ||
      input.parentSessionId === null
    ) {
      createInput.parentSessionId = input.parentSessionId;
    }
    if (
      input.parentRelationKind === "fork" ||
      input.parentRelationKind === "subagent" ||
      input.parentRelationKind === "hook_subagent" ||
      input.parentRelationKind === null
    ) {
      createInput.parentRelationKind = input.parentRelationKind;
    }
    if (
      typeof input.forkReplayCheckpointId === "string" ||
      input.forkReplayCheckpointId === null
    ) {
      createInput.forkReplayCheckpointId = input.forkReplayCheckpointId;
    }

    if (typeof input.workingDirectory === "string") {
      createInput.workingDirectory = input.workingDirectory;
    }
    if (input.thinkingEffort) {
      createInput.thinkingEffort = normalizeThinkingEffort(
        input.thinkingEffort
      );
    }
    if (typeof input.userId === "string" && input.userId.length > 0) {
      createInput.userId = input.userId;
    }
    if (typeof input.yoloMode === "boolean") {
      createInput.yoloMode = input.yoloMode;
    }
    if (typeof input.planModeEnabled === "boolean") {
      createInput.planModeEnabled = input.planModeEnabled;
    }
    if (typeof input.contextWindow === "number") {
      createInput.contextWindow = input.contextWindow;
    }
    if (typeof input.maxTurns === "number") {
      createInput.maxTurns = input.maxTurns;
    }
    if (Array.isArray(input.shellAllowPatterns)) {
      createInput.shellAllowPatterns = input.shellAllowPatterns;
    }
    if (Array.isArray(input.shellDenyPatterns)) {
      createInput.shellDenyPatterns = input.shellDenyPatterns;
    }
    if (Array.isArray(input.toolAllowList)) {
      createInput.toolAllowList = input.toolAllowList;
    }
    if (Array.isArray(input.toolAskList)) {
      createInput.toolAskList = input.toolAskList;
    }
    if (Array.isArray(input.toolDenyList)) {
      createInput.toolDenyList = input.toolDenyList;
    }
    if (Array.isArray(input.enabledCapabilityPacks)) {
      createInput.enabledCapabilityPacks = input.enabledCapabilityPacks;
    }

    return this.options.sessionManager.createSession(createInput);
  }

  async recoverSession(
    snapshot: Parameters<SessionManager["recover"]>[0]
  ): ReturnType<SessionManager["recover"]> {
    return this.options.sessionManager.recover(snapshot);
  }

  async run(
    input: RunSessionInput & { eventSink?: RunEventSink }
  ): Promise<RunSessionResult> {
    const eventSink = input.eventSink ?? this.options.eventSink;
    let session = await this.options.sessionManager.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    const runId = randomUUID();
    const traceManager = createRunScopedTraceManager(
      this.options.traceManager,
      runId
    );
    const runtimeLogger = this.runtimeLogger?.child({
      sessionId: input.sessionId,
      runId
    });
    const toolLogger = this.options.systemLogManager
      ? createLogger({
          manager: this.options.systemLogManager,
          component: "tool-execution",
          context: { sessionId: input.sessionId, runId }
        })
      : undefined;
    const permissionLogger = this.options.systemLogManager
      ? createLogger({
          manager: this.options.systemLogManager,
          component: "permission",
          context: { sessionId: input.sessionId, runId }
        })
      : undefined;
    const executionLeaseTimeoutMs =
      this.options.executionLeaseTimeoutMs ??
      DEFAULT_EXECUTION_LEASE_TIMEOUT_MS;
    await runtimeLogger?.info("run_started", {
      hasMessage: typeof input.message === "string",
      permissionReply: input.permissionReply ?? null
    });
    const interruptController = new AbortController();
    const acquiredSession = await this.options.sessionManager.acquireExecution(
      input.sessionId,
      {
        runId,
        staleAfterMs: executionLeaseTimeoutMs
      }
    );
    if (!acquiredSession) {
      throw new SessionExecutionInProgressError(input.sessionId);
    }
    this.options.sessionManager.registerExecutionAbort(
      input.sessionId,
      runId,
      interruptController
    );
    session = acquiredSession;
    let interruptWatcher: ReturnType<typeof setInterval> | null = null;
    let interruptCheckInFlight = false;

    try {
      interruptWatcher = setInterval(() => {
        if (interruptCheckInFlight || interruptController.signal.aborted) {
          return;
        }

        interruptCheckInFlight = true;
        void this.options.sessionManager
          .isInterruptRequested(input.sessionId, runId)
          .then((requested) => {
            if (requested) {
              interruptController.abort();
            }
          })
          .finally(() => {
            interruptCheckInFlight = false;
          });
      }, 150);

      const requestOptions = this.resolveRequestOptions(session);
      if (
        this.shouldRunSubagentHooks({
          session,
          message: input.message,
          ...(typeof input.skipSubagentHooks === "boolean"
            ? { skipSubagentHooks: input.skipSubagentHooks }
            : {})
        })
      ) {
        const scheduled = await this.schedulePreRunSubagentHooks({
          session,
          message: input.message!,
          traceManager
        });
        session = scheduled.session;
        if (scheduled.blockingTaskIds.length > 0) {
          await scheduleBackgroundTaskPollWakeup({
            sessionManager: this.options.sessionManager,
            taskManager: this.options.backgroundTaskManager!,
            parentSessionId: session.sessionId,
            taskIds: scheduled.blockingTaskIds,
            initialCheckAfterMs: 1_000,
            ...(typeof input.message === "string"
              ? { wakeupMessage: input.message }
              : {}),
            extraMetadata: {
              skipSubagentHooks: true
            }
          });
          session = await this.options.sessionManager.updateContext(
            session.sessionId,
            {
              status: "waiting_for_user_input"
            }
          );
          const blockedResult = await completeLocally({
            sessionManager: this.options.sessionManager,
            traceManager,
            session,
            turnCount: Math.max(0, session.sessionState.turnCount),
            loopState: "waiting for input",
            finalAnswer: "",
            stopReason: "background_task_running",
            toolCallCount: 0,
            toolResultCount: 0,
            toolOutputs: [],
            eventSink,
            appendAssistantMessage: false
          });
          await runtimeLogger?.info("run_completed", {
            stopReason: blockedResult.stopReason,
            toolCallCount: blockedResult.toolCallCount,
            toolResultCount: blockedResult.toolResultCount
          });
          return blockedResult;
        }
      }
      const activeSession = session;
      const runLoopBaseInput = {
        client: this.resolveClient(activeSession.model),
        prepareMessages: (messages: AnthropicMessage[]) =>
          this.sanitizeMessagesForModel(activeSession.model, messages),
        sessionManager: this.options.sessionManager,
        routineRepository: this.options.routineRepository,
        ...(this.options.cronJobRepository
          ? { cronJobRepository: this.options.cronJobRepository }
          : {}),
        toolRegistry: this.options.toolRegistry,
        traceManager,
        promptBuilder: this.promptBuilder,
        userContextHooks: this.options.userContextHooks ?? [],
        workspaceSkillSettings: this.options.workspaceSkillSettings ?? [],
        abortSignal: interruptController.signal,
        isInterruptRequested: () =>
          this.options.sessionManager.isInterruptRequested(
            input.sessionId,
            runId
          ),
        ...(typeof input.permissionReply === "boolean"
          ? { permissionReply: input.permissionReply }
          : {}),
        maxTurns:
          input.maxTurns ??
          activeSession.maxTurns ??
          this.options.maxTurns ??
          50,
        maxTokens: this.options.maxTokens,
        toolChoice: this.options.toolChoice,
        eventSink,
        ...(this.options.delegateAgentService
          ? { delegateAgentService: this.options.delegateAgentService }
          : {}),
        ...(this.options.backgroundTaskManager
          ? { backgroundTaskManager: this.options.backgroundTaskManager }
          : {}),
        ...(typeof this.options.userCustomPrompt === "string"
          ? { userCustomPrompt: this.options.userCustomPrompt }
          : {}),
        ...(input.skipSubagentHooks === true
          ? { resumeBlockedBySubagentHook: true }
          : {}),
        ...(requestOptions ? { requestOptions } : {}),
        ...(runtimeLogger ? { logger: runtimeLogger } : {}),
        ...(toolLogger ? { toolLogger } : {}),
        ...(permissionLogger ? { permissionLogger } : {})
      };
      let currentSession = session;
      let aggregateResult: RunSessionResult | null = null;
      const appendResult = (result: RunSessionResult): RunSessionResult => {
        if (!aggregateResult) {
          aggregateResult = result;
          return result;
        }

        aggregateResult = {
          ...result,
          toolCallCount: aggregateResult.toolCallCount + result.toolCallCount,
          toolResultCount:
            aggregateResult.toolResultCount + result.toolResultCount,
          toolOutputs: [...aggregateResult.toolOutputs, ...result.toolOutputs]
        };
        return aggregateResult;
      };
      const runQueuedMessage = async (
        message: string | undefined,
        options: {
          emitCompletedRunEvent?: boolean;
          messageBlock?: UserConversationBlock;
        } = {}
      ): Promise<RunSessionResult> => {
        const result = await runSessionLoop({
          ...runLoopBaseInput,
          session: currentSession,
          message,
          ...(options.messageBlock
            ? { messageBlock: options.messageBlock }
            : {}),
          ...(typeof options.emitCompletedRunEvent === "boolean"
            ? { emitCompletedRunEvent: options.emitCompletedRunEvent }
            : {})
        });
        currentSession = result.session;
        return appendResult(result);
      };

      let result: RunSessionResult;
      if (typeof input.message === "string") {
        const preHookMessages = this.resolvePreUserHookMessages(session);
        for (const hookMessage of preHookMessages) {
          result = await runQueuedMessage(hookMessage.content, {
            emitCompletedRunEvent: false,
            messageBlock: hookMessage
          });
          if (result.status !== "completed") {
            await runtimeLogger?.info("run_completed", {
              stopReason: result.stopReason,
              toolCallCount: result.toolCallCount,
              toolResultCount: result.toolResultCount
            });
            return result;
          }
        }

        const postHookMessages = this.resolvePostUserHookMessages(session);
        const hasPostRunSubagentHooks = (
          this.options.userContextHooks ?? []
        ).some(
          (hook) => isSubagentUserContextHook(hook) && hook.event === "run_end"
        );
        result = await runQueuedMessage(input.message, {
          emitCompletedRunEvent:
            postHookMessages.length === 0 && !hasPostRunSubagentHooks
        });
        if (result.status === "completed") {
          for (const [index, hookMessage] of postHookMessages.entries()) {
            result = await runQueuedMessage(hookMessage.content, {
              emitCompletedRunEvent:
                index === postHookMessages.length - 1 &&
                !hasPostRunSubagentHooks,
              messageBlock: hookMessage
            });
            if (result.status !== "completed") {
              break;
            }
          }
        }
        if (result.status === "completed" && hasPostRunSubagentHooks) {
          currentSession = await this.schedulePostRunSubagentHooks({
            session: currentSession,
            traceManager
          });
          result = {
            ...result,
            session: currentSession
          };
          if (eventSink) {
            await eventSink(
              createRunCompleteEvent({
                session: result.session,
                finalAnswer: result.finalAnswer,
                status: result.status,
                stopReason: result.stopReason,
                toolCallCount: result.toolCallCount,
                toolResultCount: result.toolResultCount,
                toolOutputs: result.toolOutputs
              })
            );
          }
        }
      } else {
        result = await runQueuedMessage(input.message);
      }

      await runtimeLogger?.info("run_completed", {
        stopReason: result.stopReason,
        toolCallCount: result.toolCallCount,
        toolResultCount: result.toolResultCount
      });
      return result;
    } catch (error) {
      await runtimeLogger?.error("run_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      if (interruptWatcher) {
        clearInterval(interruptWatcher);
      }

      try {
        await runtimeLogger?.debug("release_execution", {
          sessionId: input.sessionId
        });
        await this.options.sessionManager.releaseExecution(
          input.sessionId,
          runId
        );
      } catch {
        // Ignore release failures so the primary error is preserved.
      }
    }
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(options);
}

export function toAnthropicMessageBlocks(
  blocks: ConversationBlock[]
): AnthropicMessage[] {
  return toAnthropicMessages(blocks);
}
