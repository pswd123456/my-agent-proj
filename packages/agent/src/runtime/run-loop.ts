import { randomUUID } from "node:crypto";

import type { RoutineRepository } from "@ai-app-template/db";

import {
  createRunTraceEvent,
  createRunCompleteEvent,
  createRunErrorEvent,
  type RunEventSink
} from "../events.js";
import type {
  AnthropicCompatibleClient,
  AnthropicMessage,
  AnthropicMessageRequest,
  AnthropicToolChoice
} from "../model.js";
import { streamAnthropicMessage } from "../model.js";
import {
  formatPromptDateTimeContext,
  resolvePromptTimeZone,
  summarizePromptEnvelopeComposition,
  type PromptBuilder
} from "../prompt.js";
import type { SessionManager } from "../session.js";
import { discoverWorkspaceSkills } from "../skills/index.js";
import type { TraceManager } from "../trace.js";
import type { Logger } from "../system-log.js";
import type { JsonValue, RunSessionResult, SessionSnapshot } from "../types.js";
import type { DelegateAgentService } from "../delegation/index.js";
import { consumeBackgroundNotifications } from "../background-tasks/notifications.js";
import type { ToolRegistry } from "../tools/registry.js";
import {
  buildAssistantBlockContent,
  buildAssistantThinkingBlockContent,
  buildFallbackAnswer,
  buildToolCallBlock,
  buildUserBlockContent,
  extractToolCalls,
  extractToolCallsFromTextBlocks,
  renderPendingConfirmationAnswer,
  renderPendingUserQuestionAnswer,
  stripTextToolCallMarkup
} from "./blocks.js";
import { completeLocally } from "./complete-run.js";
import { handlePendingConfirmationReply } from "./confirmation.js";
import { completeInterruptedRun } from "./interrupt.js";
import { handlePendingPermissionReply } from "./permission.js";
import { appendTrace, emitRunEvent, emitTraceEvent } from "./run-events.js";
import { preparePromptWithCompaction } from "./compaction.js";
import { executeToolAction } from "./tool-execution.js";
import { handlePendingUserQuestionReply } from "./user-question.js";

interface StreamedAssistantSnapshot {
  assistantMessageId: string;
  text: string;
}

interface StreamedThinkingSnapshot {
  thinkingMessageId: string;
  text: string;
  signature: string;
}

const ACTIVE_DELEGATE_STATUSES = new Set([
  "queued",
  "claimed",
  "running",
  "cancelling"
]);

interface ActiveDelegateResult {
  delegateId: string;
  status: string;
  waitMode: "blocking" | "unblocking";
  initialCheckAfterMs: number;
}

function clampDelegateInitialCheckAfterMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1_000, Math.min(120_000, Math.floor(value)))
    : 5_000;
}

function getActiveDelegateResult(
  output: RunSessionResult["toolOutputs"][number]
): ActiveDelegateResult | null {
  if (output.toolName !== "delegate_agent" || output.isError) {
    return null;
  }

  try {
    const parsed = JSON.parse(output.content) as {
      ok?: boolean;
      code?: string;
      data?: {
        delegate_id?: unknown;
        status?: unknown;
        wait_mode?: unknown;
        initial_check_after_ms?: unknown;
      };
    };
    if (parsed?.ok !== true || parsed?.code !== "DELEGATE_AGENT_OK") {
      return null;
    }

    if (
      typeof parsed.data?.delegate_id !== "string" ||
      typeof parsed.data.status !== "string" ||
      !ACTIVE_DELEGATE_STATUSES.has(parsed.data.status)
    ) {
      return null;
    }

    return {
      delegateId: parsed.data.delegate_id,
      status: parsed.data.status,
      waitMode:
        parsed.data.wait_mode === "unblocking" ? "unblocking" : "blocking",
      initialCheckAfterMs: clampDelegateInitialCheckAfterMs(
        parsed.data.initial_check_after_ms
      )
    };
  } catch {
    return null;
  }
}

function getUnresolvedPendingToolCalls(session: SessionSnapshot): Array<{
  id: string;
  name: string;
  input: Record<string, JsonValue>;
  responseGroupId?: string;
}> {
  const pendingIds = session.sessionState.pendingToolCallIds ?? [];
  if (pendingIds.length === 0) {
    return [];
  }

  const completedIds = new Set(
    session.messages
      .filter(
        (
          block
        ): block is Extract<
          SessionSnapshot["messages"][number],
          { kind: "tool result" }
        > => block.kind === "tool result"
      )
      .map((block) => block.toolCallId)
  );
  const pendingToolCalls = new Map(
    session.messages
      .filter(
        (
          block
        ): block is Extract<
          SessionSnapshot["messages"][number],
          { kind: "tool call" }
        > => block.kind === "tool call"
      )
      .map((block) => [block.toolCallId, block] as const)
  );

  return pendingIds
    .filter((toolCallId) => !completedIds.has(toolCallId))
    .map((toolCallId) => pendingToolCalls.get(toolCallId))
    .filter((toolCall): toolCall is NonNullable<typeof toolCall> =>
      Boolean(toolCall)
    )
    .map((toolCall) => ({
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      input: toolCall.input as Record<string, JsonValue>,
      ...(toolCall.responseGroupId
        ? { responseGroupId: toolCall.responseGroupId }
        : {})
    }));
}

function getInterruptedAssistantSnapshot(
  streamedAssistantTexts: Map<number, StreamedAssistantSnapshot> | null
): StreamedAssistantSnapshot | null {
  if (!streamedAssistantTexts || streamedAssistantTexts.size === 0) {
    return null;
  }

  const ordered = [...streamedAssistantTexts.entries()].sort(
    ([leftIndex], [rightIndex]) => leftIndex - rightIndex
  );
  const text = ordered
    .map(([, value]) => value.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    return null;
  }

  return {
    assistantMessageId:
      ordered[ordered.length - 1]?.[1].assistantMessageId ?? randomUUID(),
    text
  };
}

export async function runSessionLoop(input: {
  client: AnthropicCompatibleClient;
  prepareMessages?: (messages: AnthropicMessage[]) => AnthropicMessage[];
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  delegateAgentService?: DelegateAgentService;
  traceManager: TraceManager | undefined;
  promptBuilder: PromptBuilder;
  session: SessionSnapshot;
  message: string | undefined;
  abortSignal?: AbortSignal;
  isInterruptRequested: () => Promise<boolean>;
  permissionReply?: boolean;
  maxTurns: number;
  maxTokens: number | undefined;
  toolChoice: AnthropicToolChoice | undefined;
  eventSink: RunEventSink | undefined;
  logger?: Logger;
}): Promise<RunSessionResult> {
  let session = input.session;
  const runtimeContext = {
    currentDateTimeContext: formatPromptDateTimeContext(),
    currentTimeZone: resolvePromptTimeZone()
  };
  const pendingConfirmationAtStart = session.context.pendingConfirmationPayload
    ? structuredClone(session.context.pendingConfirmationPayload)
    : null;
  const pendingUserQuestionAtStart = session.context.pendingUserQuestionPayload
    ? structuredClone(session.context.pendingUserQuestionPayload)
    : null;
  const pendingPermissionAtStart = session.context.pendingPermissionRequest
    ? structuredClone(session.context.pendingPermissionRequest)
    : null;
  let visibleBackgroundNotificationIds =
    session.context.pendingBackgroundNotifications.map(
      (notification) => notification.id
    );
  const discoveredSkills = await discoverWorkspaceSkills(
    session.workingDirectory
  );

  let stopReason: string | null = null;
  let toolCallCount = 0;
  let toolResultCount = 0;
  const toolOutputs: RunSessionResult["toolOutputs"] = [];
  const activeUnblockingDelegates = new Map<string, number>();
  let consumedPermissionReply = false;
  let carriedTurnCount = 0;
  let currentTurnCount = Math.max(0, session.sessionState.turnCount);
  let currentStreamedAssistantTexts: Map<
    number,
    StreamedAssistantSnapshot
  > | null = null;
  let interruptRequestLogged = false;

  async function maybeCompleteInterrupted(): Promise<RunSessionResult | null> {
    const interruptRequested = await input.isInterruptRequested();
    if (!interruptRequested) {
      return null;
    }

    if (!interruptRequestLogged) {
      await emitTraceEvent({
        traceManager: input.traceManager,
        eventSink: input.eventSink,
        sessionId: session.sessionId,
        event: {
          kind: "interrupt_requested",
          turnCount: currentTurnCount
        }
      });
      interruptRequestLogged = true;
    }

    const partialAssistant = getInterruptedAssistantSnapshot(
      currentStreamedAssistantTexts
    );
    return completeInterruptedRun({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      session,
      turnCount: currentTurnCount,
      toolCallCount,
      toolResultCount,
      toolOutputs,
      eventSink: input.eventSink,
      partialAssistantText: partialAssistant?.text ?? null,
      partialAssistantMessageId: partialAssistant?.assistantMessageId ?? null
    });
  }

  async function consumeHandledBackgroundNotifications(
    turnCount: number,
    notificationIds = visibleBackgroundNotificationIds
  ): Promise<SessionSnapshot | null> {
    if (notificationIds.length === 0) {
      return null;
    }

    await consumeBackgroundNotifications({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      turnCount,
      notificationIds
    });

    const refreshedSession = await input.sessionManager.getSession(
      session.sessionId
    );
    if (refreshedSession) {
      session = refreshedSession;
      return refreshedSession;
    }

    return null;
  }

  async function finalizeResultAfterNotificationConsumption(
    result: RunSessionResult,
    turnCount: number,
    notificationIds = visibleBackgroundNotificationIds
  ): Promise<RunSessionResult> {
    session =
      (await input.sessionManager.getSession(session.sessionId)) ?? session;
    const notificationIdsToConsume = new Set(notificationIds);
    if (result.status === "completed") {
      for (const notification of session.context.pendingBackgroundNotifications) {
        if (!notification.requiresMainAgentReply) {
          notificationIdsToConsume.add(notification.id);
        }
      }
    }

    const refreshedSession = await consumeHandledBackgroundNotifications(
      turnCount,
      [...notificationIdsToConsume]
    );
    if (!refreshedSession) {
      return result;
    }

    return {
      ...result,
      session: refreshedSession
    };
  }

  async function maybePauseForActiveDelegate(inputForPause: {
    output: RunSessionResult["toolOutputs"][number];
    turnCount: number;
    notificationIds: string[];
  }): Promise<RunSessionResult | null> {
    const activeDelegate = getActiveDelegateResult(inputForPause.output);
    if (!activeDelegate) {
      return null;
    }

    if (activeDelegate.waitMode === "unblocking") {
      activeUnblockingDelegates.set(
        activeDelegate.delegateId,
        activeDelegate.initialCheckAfterMs
      );
      return null;
    }

    session =
      (await input.sessionManager.getSession(session.sessionId)) ?? session;
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_user_input"
    });

    const result = await completeLocally({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      session,
      turnCount: inputForPause.turnCount,
      loopState: "waiting for input",
      finalAnswer: "",
      stopReason: "background_task_running",
      toolCallCount,
      toolResultCount,
      toolOutputs,
      eventSink: input.eventSink,
      appendAssistantMessage: false
    });

    return finalizeResultAfterNotificationConsumption(
      result,
      inputForPause.turnCount,
      inputForPause.notificationIds
    );
  }

  async function maybePauseForUnblockingDelegates(inputForPause: {
    turnCount: number;
    notificationIds: string[];
  }): Promise<RunSessionResult | null> {
    if (activeUnblockingDelegates.size === 0 || !input.delegateAgentService) {
      return null;
    }

    session =
      (await input.sessionManager.getSession(session.sessionId)) ?? session;
    if (
      session.context.pendingBackgroundNotifications.length > 0 ||
      session.context.pendingPermissionRequest ||
      session.context.pendingConfirmationPayload ||
      session.context.pendingUserQuestionPayload ||
      session.context.status === "waiting_for_permission" ||
      session.context.status === "waiting_for_conflict_confirmation" ||
      session.context.status === "waiting_for_user_question"
    ) {
      return null;
    }

    await input.delegateAgentService.scheduleDelegatePollWakeup({
      parentSessionId: session.sessionId,
      delegateIds: [...activeUnblockingDelegates.keys()],
      initialCheckAfterMs: Math.min(...activeUnblockingDelegates.values())
    });

    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_user_input"
    });

    const result = await completeLocally({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      session,
      turnCount: inputForPause.turnCount,
      loopState: "waiting for input",
      finalAnswer: "",
      stopReason: "background_task_running",
      toolCallCount,
      toolResultCount,
      toolOutputs,
      eventSink: input.eventSink,
      appendAssistantMessage: false
    });

    return finalizeResultAfterNotificationConsumption(
      result,
      inputForPause.turnCount,
      inputForPause.notificationIds
    );
  }

  try {
    if (pendingPermissionAtStart && input.message) {
      const handled = await handlePendingPermissionReply({
        sessionManager: input.sessionManager,
        routineRepository: input.routineRepository,
        toolRegistry: input.toolRegistry,
        traceManager: input.traceManager,
        session,
        message: input.message,
        permissionReply: input.permissionReply ?? false,
        pendingPermissionRequest: pendingPermissionAtStart,
        eventSink: input.eventSink
      });
      if (handled?.kind === "completed") {
        return handled.result;
      }
      if (handled?.kind === "approved") {
        consumedPermissionReply = true;
        session = handled.session;
        toolResultCount += handled.toolResultCount;
        toolOutputs.push(...handled.toolOutputs);
        carriedTurnCount = Math.max(0, session.sessionState.turnCount);
      }
    }

    if (
      pendingUserQuestionAtStart &&
      input.message &&
      !consumedPermissionReply
    ) {
      session = await handlePendingUserQuestionReply({
        sessionManager: input.sessionManager,
        session
      });
    }

    if (input.message && !consumedPermissionReply) {
      session = await input.sessionManager.appendBlock(
        session.sessionId,
        buildUserBlockContent(input.message)
      );
      session = await input.sessionManager.updateContext(session.sessionId, {
        lastUserMessage: input.message,
        status: "running"
      });
    }

    if (
      pendingConfirmationAtStart &&
      input.message &&
      !consumedPermissionReply
    ) {
      const handled = await handlePendingConfirmationReply({
        sessionManager: input.sessionManager,
        routineRepository: input.routineRepository,
        toolRegistry: input.toolRegistry,
        traceManager: input.traceManager,
        session,
        message: input.message,
        pendingConfirmation: pendingConfirmationAtStart,
        eventSink: input.eventSink
      });
      if (handled) {
        return handled;
      }
    }

    session = await input.sessionManager.setLoopState(
      session.sessionId,
      "running"
    );

    {
      const interrupted = await maybeCompleteInterrupted();
      if (interrupted) {
        return interrupted;
      }
    }

    if (
      consumedPermissionReply &&
      session.sessionState.pendingToolCallIds.length > 0
    ) {
      const pendingToolCalls = getUnresolvedPendingToolCalls(session);

      for (const toolCall of pendingToolCalls) {
        const executed = await executeToolAction({
          sessionManager: input.sessionManager,
          routineRepository: input.routineRepository,
          toolRegistry: input.toolRegistry,
          ...(input.delegateAgentService
            ? { delegateAgentService: input.delegateAgentService }
            : {}),
          traceManager: input.traceManager,
          session,
          turnCount: Math.max(1, carriedTurnCount),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: toolCall.input,
          ...(toolCall.responseGroupId
            ? { responseGroupId: toolCall.responseGroupId }
            : {}),
          eventSink: input.eventSink,
          skipAppendToolCall: true,
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {})
        });
        session = executed.session;
        toolCallCount += 1;
        if (executed.kind === "permission_request") {
          const result = await completeLocally({
            sessionManager: input.sessionManager,
            traceManager: input.traceManager,
            session,
            turnCount: Math.max(1, carriedTurnCount),
            loopState: "waiting for input",
            finalAnswer: "",
            stopReason: "tool_use",
            toolCallCount,
            toolResultCount,
            toolOutputs,
            eventSink: input.eventSink,
            appendAssistantMessage: false,
            clearPendingToolCallIds: false
          });
          return finalizeResultAfterNotificationConsumption(
            result,
            Math.max(1, carriedTurnCount)
          );
        }

        toolResultCount += 1;
        toolOutputs.push(executed.output);

        const pausedForActiveDelegate = await maybePauseForActiveDelegate({
          output: executed.output,
          turnCount: Math.max(1, carriedTurnCount),
          notificationIds: visibleBackgroundNotificationIds
        });
        if (pausedForActiveDelegate) {
          return pausedForActiveDelegate;
        }

        {
          const interrupted = await maybeCompleteInterrupted();
          if (interrupted) {
            return interrupted;
          }
        }
      }

      session =
        (await input.sessionManager.getSession(session.sessionId)) ?? session;
      session = await input.sessionManager.setPendingToolCallIds(
        session.sessionId,
        []
      );
      session = await input.sessionManager.setLoopState(
        session.sessionId,
        "running"
      );
    }

    for (let turn = carriedTurnCount; turn < input.maxTurns; turn += 1) {
      const turnCount = turn + 1;
      currentTurnCount = turnCount;
      currentStreamedAssistantTexts = null;
      session = await input.sessionManager.saveSession(session);
      session = await input.sessionManager.setTurnCount(
        session.sessionId,
        turnCount
      );
      const notificationIdsVisibleThisTurn =
        session.context.pendingBackgroundNotifications.map(
          (notification) => notification.id
        );
      visibleBackgroundNotificationIds = notificationIdsVisibleThisTurn;

      {
        const interrupted = await maybeCompleteInterrupted();
        if (interrupted) {
          return interrupted;
        }
      }

      const preparedPrompt = await preparePromptWithCompaction({
        client: input.client,
        sessionManager: input.sessionManager,
        promptBuilder: input.promptBuilder,
        toolRegistry: input.toolRegistry,
        traceManager: input.traceManager,
        eventSink: input.eventSink,
        session,
        turnCount,
        toolChoice: input.toolChoice,
        runtimeContext: {
          ...runtimeContext,
          currentTurnCount: turnCount,
          maxTurns: input.maxTurns
        },
        skills: discoveredSkills.skills,
        ...(typeof input.maxTokens === "number"
          ? { maxTokens: input.maxTokens }
          : {})
      });
      session = preparedPrompt.session;
      const promptEnvelope = preparedPrompt.promptEnvelope;
      session = await input.sessionManager.setPromptCacheKey(
        session.sessionId,
        promptEnvelope.cacheKey
      );

      await emitTraceEvent({
        traceManager: input.traceManager,
        eventSink: input.eventSink,
        sessionId: session.sessionId,
        event: {
          kind: "skills_loaded",
          turnCount,
          skills: discoveredSkills.skills,
          diagnostics: discoveredSkills.diagnostics
        }
      });
      await emitTraceEvent({
        traceManager: input.traceManager,
        eventSink: input.eventSink,
        sessionId: session.sessionId,
        event: {
          kind: "turn_start",
          turnCount,
          session: {
            sessionId: session.sessionId,
            workingDirectory: session.workingDirectory,
            model: session.model,
            sessionState: session.sessionState
          }
        }
      });
      await emitTraceEvent({
        traceManager: input.traceManager,
        eventSink: input.eventSink,
        sessionId: session.sessionId,
        event: {
          kind: "prompt",
          turnCount,
          system: promptEnvelope.system,
          prefixMessages: promptEnvelope.prefixMessages,
          messages: promptEnvelope.messages,
          runtimeContextMessages: promptEnvelope.runtimeContextMessages,
          dynamicPromptMessages: promptEnvelope.dynamicPromptMessages,
          tools: promptEnvelope.tools,
          toolChoice: input.toolChoice ?? null,
          cacheKey: promptEnvelope.cacheKey,
          compositionStats: summarizePromptEnvelopeComposition(promptEnvelope)
        }
      });

      const estimatedInputTokens = preparedPrompt.estimatedInputTokens;
      if (estimatedInputTokens > session.contextWindow) {
        const errorMessage = [
          `Estimated prompt input ${estimatedInputTokens} tokens exceeds the configured context window ${session.contextWindow}.`,
          "Compaction could not reduce the prompt below the configured context window."
        ].join(" ");
        session = await input.sessionManager.updateContext(session.sessionId, {
          status: "failed"
        });
        session = await input.sessionManager.setPendingToolCallIds(
          session.sessionId,
          []
        );
        session = await input.sessionManager.setLastError(
          session.sessionId,
          errorMessage
        );
        session = await input.sessionManager.setLoopState(
          session.sessionId,
          "failed"
        );
        await emitTraceEvent({
          traceManager: input.traceManager,
          eventSink: input.eventSink,
          sessionId: session.sessionId,
          event: {
            kind: "turn_end",
            turnCount,
            loopState: "failed"
          }
        });
        const result = {
          session,
          finalAnswer: null,
          status: "failed" as const,
          stopReason: "context_window_exceeded" as const,
          toolCallCount,
          toolResultCount,
          toolOutputs
        };
        if (input.eventSink) {
          await emitRunEvent(
            input.eventSink,
            createRunErrorEvent({
              sessionId: session.sessionId,
              session,
              error: errorMessage,
              status: "failed",
              stopReason: "context_window_exceeded",
              toolCallCount,
              toolResultCount,
              toolOutputs
            })
          );
        }
        return result;
      }

      {
        const interrupted = await maybeCompleteInterrupted();
        if (interrupted) {
          return interrupted;
        }
      }

      const request: AnthropicMessageRequest = {
        model: session.model,
        system: promptEnvelope.system,
        messages: input.prepareMessages?.([
          ...promptEnvelope.prefixMessages,
          ...promptEnvelope.messages,
          ...promptEnvelope.runtimeContextMessages
        ]) ?? [
          ...promptEnvelope.prefixMessages,
          ...promptEnvelope.messages,
          ...promptEnvelope.runtimeContextMessages
        ],
        tools: promptEnvelope.tools,
        ...(typeof input.maxTokens === "number"
          ? { max_tokens: input.maxTokens }
          : {}),
        ...(input.toolChoice ? { tool_choice: input.toolChoice } : {})
      };

      const streamedAssistantTexts = new Map<
        number,
        StreamedAssistantSnapshot
      >();
      const streamedThinkingSnapshots = new Map<
        number,
        StreamedThinkingSnapshot
      >();
      currentStreamedAssistantTexts = streamedAssistantTexts;
      const response = await streamAnthropicMessage({
        client: input.client,
        request,
        ...(input.abortSignal ? { signal: input.abortSignal } : {}),
        onTextDelta: async ({ blockIndex, text }) => {
          const current = streamedAssistantTexts.get(blockIndex) ?? {
            assistantMessageId: randomUUID(),
            text: ""
          };
          current.text = text;
          streamedAssistantTexts.set(blockIndex, current);
          if (input.eventSink) {
            await emitRunEvent(
              input.eventSink,
              createRunTraceEvent(session.sessionId, {
                kind: "assistant_text",
                turnCount,
                assistantMessageId: current.assistantMessageId,
                text,
                snapshot: text
              })
            );
          }
        },
        onThinkingDelta: async ({ blockIndex, delta, text, signature }) => {
          const current = streamedThinkingSnapshots.get(blockIndex) ?? {
            thinkingMessageId: randomUUID(),
            text: "",
            signature: ""
          };
          current.text = text;
          current.signature = signature;
          streamedThinkingSnapshots.set(blockIndex, current);
          if (input.eventSink) {
            await emitRunEvent(
              input.eventSink,
              createRunTraceEvent(session.sessionId, {
                kind: "thinking",
                turnCount,
                thinkingMessageId: current.thinkingMessageId,
                text,
                signature,
                ...(delta ? { delta } : {}),
                snapshot: text
              })
            );
          }
        }
      });

      {
        const interrupted = await maybeCompleteInterrupted();
        if (interrupted) {
          return interrupted;
        }
      }

      const usageTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const cacheCreationInputTokens =
        response.usage?.cache_creation_input_tokens ?? 0;
      const cacheReadInputTokens = response.usage?.cache_read_input_tokens ?? 0;
      if (usageTokens > 0) {
        session = await input.sessionManager.addInputTokens(
          session.sessionId,
          usageTokens
        );
      }

      const responseBlocks = response.content ?? [];
      stopReason = response.stop_reason ?? null;
      await emitTraceEvent({
        traceManager: input.traceManager,
        eventSink: input.eventSink,
        sessionId: session.sessionId,
        event: {
          kind: "response",
          turnCount,
          stopReason,
          usage: {
            inputTokens: usageTokens,
            outputTokens,
            cacheCreationInputTokens,
            cacheReadInputTokens
          },
          content: structuredClone(responseBlocks) as unknown as JsonValue
        }
      });

      const thinkingBlocks = responseBlocks.flatMap((block, blockIndex) =>
        block.type === "thinking"
          ? [
              {
                blockIndex,
                text: block.thinking,
                signature: block.signature
              }
            ]
          : []
      );
      for (const thinkingBlock of thinkingBlocks) {
        const streamedSnapshot = streamedThinkingSnapshots.get(
          thinkingBlock.blockIndex
        );
        const thinkingEvent = {
          kind: "thinking" as const,
          turnCount,
          ...(streamedSnapshot
            ? { thinkingMessageId: streamedSnapshot.thinkingMessageId }
            : {}),
          text: thinkingBlock.text,
          signature: thinkingBlock.signature,
          snapshot: thinkingBlock.text
        };
        if (streamedSnapshot) {
          await appendTrace(
            input.traceManager,
            session.sessionId,
            thinkingEvent
          );
          continue;
        }
        await emitTraceEvent({
          traceManager: input.traceManager,
          eventSink: input.eventSink,
          sessionId: session.sessionId,
          event: thinkingEvent
        });
      }

      const assistantTexts: string[] = [];
      const toolCalls = extractToolCalls(responseBlocks);
      const recoveredToolCalls =
        toolCalls.length > 0
          ? []
          : extractToolCallsFromTextBlocks(responseBlocks);
      const resolvedToolCalls =
        toolCalls.length > 0 ? toolCalls : recoveredToolCalls;
      const hasSignedThinking = thinkingBlocks.some(
        (thinkingBlock) => thinkingBlock.signature.trim().length > 0
      );
      const hasVisibleAssistantText = responseBlocks.some(
        (block) =>
          block.type === "text" &&
          stripTextToolCallMarkup(block.text).length > 0
      );
      const shouldPersistThinkingWithAssistantText =
        hasSignedThinking &&
        hasVisibleAssistantText &&
        recoveredToolCalls.length === 0;
      const responseGroupId =
        toolCalls.length > 0 || shouldPersistThinkingWithAssistantText
          ? randomUUID()
          : undefined;

      if (hasSignedThinking && responseGroupId) {
        for (const thinkingBlock of thinkingBlocks) {
          if (thinkingBlock.signature.trim().length === 0) {
            continue;
          }
          session = await input.sessionManager.appendBlock(
            session.sessionId,
            buildAssistantThinkingBlockContent({
              ...thinkingBlock,
              ...(responseGroupId ? { responseGroupId } : {})
            })
          );
        }
      }

      for (const [blockIndex, block] of responseBlocks.entries()) {
        if (block.type !== "text") {
          continue;
        }

        const visibleText = stripTextToolCallMarkup(block.text);
        if (visibleText.length === 0) {
          continue;
        }

        assistantTexts.push(visibleText);
        const assistantMessageId =
          streamedAssistantTexts.get(blockIndex)?.assistantMessageId ??
          randomUUID();
        session = await input.sessionManager.appendBlock(
          session.sessionId,
          buildAssistantBlockContent(
            visibleText,
            assistantMessageId,
            responseGroupId
          )
        );
        const assistantEvent = {
          kind: "assistant_text" as const,
          turnCount,
          assistantMessageId,
          text: visibleText,
          snapshot: visibleText
        };
        if (streamedAssistantTexts.has(blockIndex)) {
          await appendTrace(
            input.traceManager,
            session.sessionId,
            assistantEvent
          );
        } else {
          await emitTraceEvent({
            traceManager: input.traceManager,
            eventSink: input.eventSink,
            sessionId: session.sessionId,
            event: assistantEvent
          });
        }
      }
      currentStreamedAssistantTexts = null;

      {
        const interrupted = await maybeCompleteInterrupted();
        if (interrupted) {
          return interrupted;
        }
      }

      if (resolvedToolCalls.length > 0) {
        if (toolCalls.length === 0 && recoveredToolCalls.length > 0) {
          await emitTraceEvent({
            traceManager: input.traceManager,
            eventSink: input.eventSink,
            sessionId: session.sessionId,
            event: {
              kind: "fallback",
              turnCount,
              reason: "provider_text_tool_call",
              summary: `Recovered  tool call from assistant text.`
            }
          });
        }
        session = await input.sessionManager.setLoopState(
          session.sessionId,
          "waiting for tool result"
        );
        session = await input.sessionManager.setPendingToolCallIds(
          session.sessionId,
          resolvedToolCalls.map((toolCall) => toolCall.id)
        );
        session = await input.sessionManager.setLastError(
          session.sessionId,
          null
        );

        for (const toolCall of resolvedToolCalls) {
          session = await input.sessionManager.appendBlock(
            session.sessionId,
            buildToolCallBlock({
              id: toolCall.id,
              name: toolCall.name,
              toolInput: toolCall.input as Record<string, JsonValue>,
              ...(responseGroupId ? { responseGroupId } : {})
            })
          );
          await emitTraceEvent({
            traceManager: input.traceManager,
            eventSink: input.eventSink,
            sessionId: session.sessionId,
            event: {
              kind: "tool_call",
              turnCount,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolCall.input as Record<string, JsonValue>
            }
          });
        }

        for (const toolCall of resolvedToolCalls) {
          const executed = await executeToolAction({
            sessionManager: input.sessionManager,
            routineRepository: input.routineRepository,
            toolRegistry: input.toolRegistry,
            ...(input.delegateAgentService
              ? { delegateAgentService: input.delegateAgentService }
              : {}),
            traceManager: input.traceManager,
            session,
            turnCount,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolInput: toolCall.input as Record<string, JsonValue>,
            ...(responseGroupId ? { responseGroupId } : {}),
            eventSink: input.eventSink,
            skipAppendToolCall: true,
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {})
          });
          session = executed.session;
          toolCallCount += 1;
          if (executed.kind === "permission_request") {
            const result = await completeLocally({
              sessionManager: input.sessionManager,
              traceManager: input.traceManager,
              session,
              turnCount,
              loopState: "waiting for input",
              finalAnswer: "",
              stopReason: stopReason ?? "tool_use",
              toolCallCount,
              toolResultCount,
              toolOutputs,
              eventSink: input.eventSink,
              appendAssistantMessage: false,
              clearPendingToolCallIds: false
            });
            return finalizeResultAfterNotificationConsumption(
              result,
              turnCount,
              notificationIdsVisibleThisTurn
            );
          }

          toolResultCount += 1;
          toolOutputs.push(executed.output);

          const pausedForActiveDelegate = await maybePauseForActiveDelegate({
            output: executed.output,
            turnCount,
            notificationIds: notificationIdsVisibleThisTurn
          });
          if (pausedForActiveDelegate) {
            return pausedForActiveDelegate;
          }

          {
            const interrupted = await maybeCompleteInterrupted();
            if (interrupted) {
              return interrupted;
            }
          }
        }

        session =
          (await input.sessionManager.getSession(session.sessionId)) ?? session;
        session = await input.sessionManager.setPendingToolCallIds(
          session.sessionId,
          []
        );

        if (
          session.context.status === "waiting_for_conflict_confirmation" &&
          session.context.pendingConfirmationPayload
        ) {
          const result = await completeLocally({
            sessionManager: input.sessionManager,
            traceManager: input.traceManager,
            session,
            turnCount,
            loopState: "waiting for input",
            finalAnswer: renderPendingConfirmationAnswer(
              session.context.pendingConfirmationPayload
            ),
            stopReason: stopReason ?? "tool_use",
            toolCallCount,
            toolResultCount,
            toolOutputs,
            eventSink: input.eventSink
          });
          return finalizeResultAfterNotificationConsumption(
            result,
            turnCount,
            notificationIdsVisibleThisTurn
          );
        }

        if (
          session.context.status === "waiting_for_user_question" &&
          session.context.pendingUserQuestionPayload
        ) {
          await emitTraceEvent({
            traceManager: input.traceManager,
            eventSink: input.eventSink,
            sessionId: session.sessionId,
            event: {
              kind: "user_question_request",
              turnCount,
              question: session.context.pendingUserQuestionPayload
            }
          });
          const result = await completeLocally({
            sessionManager: input.sessionManager,
            traceManager: input.traceManager,
            session,
            turnCount,
            loopState: "waiting for input",
            finalAnswer: renderPendingUserQuestionAnswer(
              session.context.pendingUserQuestionPayload
            ),
            stopReason: stopReason ?? "tool_use",
            toolCallCount,
            toolResultCount,
            toolOutputs,
            eventSink: input.eventSink
          });
          return finalizeResultAfterNotificationConsumption(
            result,
            turnCount,
            notificationIdsVisibleThisTurn
          );
        }

        session = await input.sessionManager.setLoopState(
          session.sessionId,
          "running"
        );
        await emitTraceEvent({
          traceManager: input.traceManager,
          eventSink: input.eventSink,
          sessionId: session.sessionId,
          event: {
            kind: "turn_end",
            turnCount,
            loopState: "running"
          }
        });
        continue;
      }

      if (assistantTexts.length > 0) {
        const pausedForUnblockingDelegates =
          await maybePauseForUnblockingDelegates({
            turnCount,
            notificationIds: notificationIdsVisibleThisTurn
          });
        if (pausedForUnblockingDelegates) {
          return pausedForUnblockingDelegates;
        }

        const finalAnswer = assistantTexts.join("\n").trim();
        if (session.context.pendingConfirmationPayload) {
          session = await input.sessionManager.updateContext(
            session.sessionId,
            {
              status: "waiting_for_conflict_confirmation"
            }
          );
          const result = await completeLocally({
            sessionManager: input.sessionManager,
            traceManager: input.traceManager,
            session,
            turnCount,
            loopState: "waiting for input",
            finalAnswer,
            stopReason,
            toolCallCount,
            toolResultCount,
            toolOutputs,
            eventSink: input.eventSink,
            appendAssistantMessage: false
          });
          return finalizeResultAfterNotificationConsumption(
            result,
            turnCount,
            notificationIdsVisibleThisTurn
          );
        }

        {
          const interrupted = await maybeCompleteInterrupted();
          if (interrupted) {
            return interrupted;
          }
        }

        if (session.context.status === "running") {
          session = await input.sessionManager.updateContext(
            session.sessionId,
            {
              status: "completed"
            }
          );
        }
        const result = await completeLocally({
          sessionManager: input.sessionManager,
          traceManager: input.traceManager,
          session,
          turnCount,
          loopState: "completed",
          finalAnswer,
          stopReason,
          toolCallCount,
          toolResultCount,
          toolOutputs,
          eventSink: input.eventSink,
          appendAssistantMessage: false
        });
        return finalizeResultAfterNotificationConsumption(
          result,
          turnCount,
          notificationIdsVisibleThisTurn
        );
      }

      const pausedForUnblockingDelegates = await maybePauseForUnblockingDelegates({
        turnCount,
        notificationIds: notificationIdsVisibleThisTurn
      });
      if (pausedForUnblockingDelegates) {
        return pausedForUnblockingDelegates;
      }

      {
        const interrupted = await maybeCompleteInterrupted();
        if (interrupted) {
          return interrupted;
        }
      }

      session = await input.sessionManager.setLoopState(
        session.sessionId,
        "failed"
      );
      session = await input.sessionManager.setLastError(
        session.sessionId,
        "Model returned no text or tool call."
      );
      await emitTraceEvent({
        traceManager: input.traceManager,
        eventSink: input.eventSink,
        sessionId: session.sessionId,
        event: {
          kind: "turn_end",
          turnCount,
          loopState: "failed"
        }
      });
      const result = {
        session,
        finalAnswer: null,
        status: "failed" as const,
        stopReason,
        toolCallCount,
        toolResultCount,
        toolOutputs
      };
      if (input.eventSink) {
        await emitRunEvent(
          input.eventSink,
          createRunErrorEvent({
            sessionId: session.sessionId,
            session,
            error: "Model returned no text or tool call.",
            status: "failed",
            stopReason,
            toolCallCount,
            toolResultCount,
            toolOutputs
          })
        );
      }
      return result;
    }

    const finalAnswer = buildFallbackAnswer(session, input.maxTurns);
    session = await input.sessionManager.updateContext(session.sessionId, {
      ...(session.context.status === "running" ? { status: "completed" } : {})
    });
    session = await input.sessionManager.appendBlock(
      session.sessionId,
      buildAssistantBlockContent(finalAnswer)
    );
    session = await input.sessionManager.setPendingToolCallIds(
      session.sessionId,
      []
    );
    session = await input.sessionManager.setLastError(session.sessionId, null);
    session = await input.sessionManager.setLoopState(
      session.sessionId,
      "completed"
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "fallback",
        turnCount: input.maxTurns,
        reason: "max_turns",
        summary: finalAnswer
      }
    });
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "turn_end",
        turnCount: input.maxTurns,
        loopState: "completed"
      }
    });

    const result = {
      session,
      finalAnswer,
      status: "completed" as const,
      stopReason: "max_turns" as const,
      toolCallCount,
      toolResultCount,
      toolOutputs
    };
    if (input.eventSink) {
      await emitRunEvent(
        input.eventSink,
        createRunCompleteEvent({
          session,
          finalAnswer,
          status: "completed",
          stopReason: "max_turns",
          toolCallCount,
          toolResultCount,
          toolOutputs
        })
      );
    }
    return finalizeResultAfterNotificationConsumption(result, input.maxTurns);
  } catch (error) {
    const interrupted = await maybeCompleteInterrupted();
    if (interrupted) {
      return interrupted;
    }

    const message = error instanceof Error ? error.message : String(error);
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "failed"
    });
    session = await input.sessionManager.setLoopState(
      session.sessionId,
      "failed"
    );
    session = await input.sessionManager.setLastError(
      session.sessionId,
      message
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "run_error",
        turnCount: currentTurnCount,
        error: message,
        stopReason,
        loopState: session.sessionState.loopState,
        contextStatus: session.context.status,
        pendingToolCallIds: [...session.sessionState.pendingToolCallIds],
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      }
    });
    if (input.eventSink) {
      await emitRunEvent(
        input.eventSink,
        createRunErrorEvent({
          sessionId: session.sessionId,
          session,
          error: message,
          status: "failed",
          stopReason,
          toolCallCount,
          toolResultCount,
          toolOutputs
        })
      );
    }
    throw error;
  }
}
