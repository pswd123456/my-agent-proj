import { randomUUID } from "node:crypto";

import type { RoutineRepository } from "@ai-app-template/db";

import type {
  AnthropicCompatibleClient,
  AnthropicMessage,
  AnthropicToolChoice
} from "./model.js";
import {
  createPromptBuilder,
  toAnthropicMessages,
  type PromptBuilder
} from "./prompt.js";
import type {
  ConversationBlock,
  RunSessionInput,
  RunSessionResult
} from "./types.js";
import type { SessionManager } from "./session.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { TraceManager } from "./trace.js";
import type { RunEventSink } from "./events.js";
import { runSessionLoop } from "./runtime/run-loop.js";

export interface AgentRuntimeOptions {
  client: AnthropicCompatibleClient;
  model: string;
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
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

  constructor(private readonly options: AgentRuntimeOptions) {
    this.promptBuilder = options.promptBuilder ?? createPromptBuilder();
  }

  async createSession(
    input: {
      workingDirectory?: string;
      model?: string;
      userId?: string;
      yoloMode?: boolean;
      contextWindow?: number;
      maxTurns?: number;
    } = {}
  ): ReturnType<SessionManager["createSession"]> {
    const createInput: {
      workingDirectory?: string;
      model?: string;
      userId?: string;
      yoloMode?: boolean;
      contextWindow?: number;
      maxTurns?: number;
    } = {
      model: input.model ?? this.options.model
    };

    if (typeof input.workingDirectory === "string") {
      createInput.workingDirectory = input.workingDirectory;
    }
    if (typeof input.userId === "string" && input.userId.length > 0) {
      createInput.userId = input.userId;
    }
    if (typeof input.yoloMode === "boolean") {
      createInput.yoloMode = input.yoloMode;
    }
    if (typeof input.contextWindow === "number") {
      createInput.contextWindow = input.contextWindow;
    }
    if (typeof input.maxTurns === "number") {
      createInput.maxTurns = input.maxTurns;
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
    const acquiredSession = await this.options.sessionManager.acquireExecution(
      input.sessionId,
      {
        runId,
        ...(typeof this.options.executionLeaseTimeoutMs === "number"
          ? { staleAfterMs: this.options.executionLeaseTimeoutMs }
          : {})
      }
    );
    if (!acquiredSession) {
      throw new SessionExecutionInProgressError(input.sessionId);
    }
    session = acquiredSession;

    try {
      return await runSessionLoop({
        client: this.options.client,
        sessionManager: this.options.sessionManager,
        routineRepository: this.options.routineRepository,
        toolRegistry: this.options.toolRegistry,
        traceManager: this.options.traceManager,
        promptBuilder: this.promptBuilder,
        session,
        message: input.message,
        maxTurns:
          input.maxTurns ?? session.maxTurns ?? this.options.maxTurns ?? 50,
        maxTokens: this.options.maxTokens,
        toolChoice: this.options.toolChoice,
        eventSink
      });
    } finally {
      try {
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
