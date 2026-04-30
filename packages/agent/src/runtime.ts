import { randomUUID } from "node:crypto";

import type { Logger, SystemLogManager } from "./system-log.js";

import type { RoutineRepository } from "@ai-app-template/db";
import {
  DEFAULT_SESSION_MODEL,
  normalizeThinkingEffort
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
  SessionSnapshot
} from "./types.js";
import type { SessionManager } from "./session.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { TraceManager } from "./trace.js";
import type { RunEventSink } from "./events.js";
import type { DelegateAgentService } from "./delegation/index.js";
import type { BackgroundTaskManager } from "./background-tasks/index.js";
import { runSessionLoop } from "./runtime/run-loop.js";
import { DEFAULT_EXECUTION_LEASE_TIMEOUT_MS } from "./session/contracts.js";

export interface AgentRuntimeOptions {
  systemLogManager?: SystemLogManager;
  runtimeLogger?: Logger;
  client?: AnthropicCompatibleClient;
  model?: string;
  modelService?: ModelService;
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  delegateAgentService?: DelegateAgentService;
  backgroundTaskManager?: BackgroundTaskManager;
  traceManager?: TraceManager;
  promptBuilder?: PromptBuilder;
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

  async createSession(
    input: {
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
    const runtimeLogger = this.runtimeLogger?.child({
      sessionId: input.sessionId,
      runId
    });
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
      const runLoopInput = {
        client: this.resolveClient(session.model),
        prepareMessages: (messages: AnthropicMessage[]) =>
          this.sanitizeMessagesForModel(session.model, messages),
        sessionManager: this.options.sessionManager,
        routineRepository: this.options.routineRepository,
        toolRegistry: this.options.toolRegistry,
        traceManager: this.options.traceManager,
        promptBuilder: this.promptBuilder,
        session,
        message: input.message,
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
          input.maxTurns ?? session.maxTurns ?? this.options.maxTurns ?? 50,
        maxTokens: this.options.maxTokens,
        toolChoice: this.options.toolChoice,
        eventSink,
        ...(this.options.delegateAgentService
          ? { delegateAgentService: this.options.delegateAgentService }
          : {}),
        ...(this.options.backgroundTaskManager
          ? { backgroundTaskManager: this.options.backgroundTaskManager }
          : {}),
        ...(requestOptions ? { requestOptions } : {}),
        ...(runtimeLogger ? { logger: runtimeLogger } : {})
      };
      const result = await runSessionLoop(runLoopInput);
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
