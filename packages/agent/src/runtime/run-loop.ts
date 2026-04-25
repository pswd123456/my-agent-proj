import { randomUUID } from "node:crypto";

import type { RoutineRepository } from "@ai-app-template/db";

import {
  createRunCompleteEvent,
  createRunErrorEvent,
  type RunEventSink
} from "../events.js";
import type {
  AnthropicCompatibleClient,
  AnthropicMessageRequest,
  AnthropicToolChoice
} from "../model.js";
import { streamAnthropicMessage } from "../model.js";
import {
  formatPromptDateTimeContext,
  resolvePromptTimeZone,
  type PromptBuilder
} from "../prompt.js";
import type { SessionManager } from "../session.js";
import { discoverWorkspaceSkills } from "../skills/index.js";
import type { TraceManager } from "../trace.js";
import type { Logger } from "../system-log.js";
import type { JsonValue, RunSessionResult, SessionSnapshot } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import {
  buildAssistantBlockContent,
  buildAssistantThinkingBlockContent,
  buildFallbackAnswer,
  buildUserBlockContent,
  extractToolCalls,
  extractToolCallsFromTextBlocks,
  renderPendingConfirmationAnswer,
  stripTextToolCallMarkup
} from "./blocks.js";
import { completeLocally } from "./complete-run.js";
import { handlePendingConfirmationReply } from "./confirmation.js";
import { completeInterruptedRun } from "./interrupt.js";
import { handlePendingPermissionReply } from "./permission.js";
import { emitRunEvent, emitTraceEvent } from "./run-events.js";
import { estimatePromptTokens } from "./token-budget.js";
import { executeToolAction } from "./tool-execution.js";

interface StreamedAssistantSnapshot {
  assistantMessageId: string;
  text: string;
}

interface StreamedThinkingSnapshot {
  thinkingMessageId: string;
  text: string;
  signature: string;
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
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
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
  const pendingPermissionAtStart = session.context.pendingPermissionRequest
    ? structuredClone(session.context.pendingPermissionRequest)
    : null;
  const discoveredSkills = await discoverWorkspaceSkills(
    session.workingDirectory
  );

  let stopReason: string | null = null;
  let toolCallCount = 0;
  let toolResultCount = 0;
  const toolOutputs: RunSessionResult["toolOutputs"] = [];
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

    for (let turn = carriedTurnCount; turn < input.maxTurns; turn += 1) {
      const turnCount = turn + 1;
      currentTurnCount = turnCount;
      currentStreamedAssistantTexts = null;
      session = await input.sessionManager.saveSession(session);
      session = await input.sessionManager.setTurnCount(
        session.sessionId,
        turnCount
      );

      {
        const interrupted = await maybeCompleteInterrupted();
        if (interrupted) {
          return interrupted;
        }
      }

      const promptEnvelope = input.promptBuilder.build(
        session,
        input.toolRegistry,
        runtimeContext,
        discoveredSkills.skills
      );
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
          tools: promptEnvelope.tools,
          toolChoice: input.toolChoice ?? null,
          cacheKey: promptEnvelope.cacheKey
        }
      });

      const estimatedInputTokens = estimatePromptTokens(
        promptEnvelope,
        input.toolChoice
      );
      if (estimatedInputTokens > session.contextWindow) {
        const errorMessage = [
          `Estimated prompt input ${estimatedInputTokens} tokens exceeds the configured context window ${session.contextWindow}.`,
          "Compaction is not available in Stage 5."
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
        messages: [
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
          await emitTraceEvent({
            traceManager: input.traceManager,
            eventSink: input.eventSink,
            sessionId: session.sessionId,
            event: {
              kind: "assistant_text",
              turnCount,
              assistantMessageId: current.assistantMessageId,
              text
            }
          });
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
          await emitTraceEvent({
            traceManager: input.traceManager,
            eventSink: input.eventSink,
            sessionId: session.sessionId,
            event: {
              kind: "thinking",
              turnCount,
              thinkingMessageId: current.thinkingMessageId,
              text,
              signature,
              ...(delta ? { delta } : {}),
              snapshot: text
            }
          });
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
        if (
          streamedSnapshot &&
          streamedSnapshot.text === thinkingBlock.text &&
          streamedSnapshot.signature === thinkingBlock.signature
        ) {
          continue;
        }
        await emitTraceEvent({
          traceManager: input.traceManager,
          eventSink: input.eventSink,
          sessionId: session.sessionId,
          event: {
            kind: "thinking",
            turnCount,
            ...(streamedSnapshot
              ? { thinkingMessageId: streamedSnapshot.thinkingMessageId }
              : {}),
            text: thinkingBlock.text,
            signature: thinkingBlock.signature,
            snapshot: thinkingBlock.text
          }
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

      if (toolCalls.length > 0) {
        for (const thinkingBlock of thinkingBlocks) {
          if (thinkingBlock.signature.trim().length === 0) {
            continue;
          }
          session = await input.sessionManager.appendBlock(
            session.sessionId,
            buildAssistantThinkingBlockContent(thinkingBlock)
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
          buildAssistantBlockContent(visibleText, assistantMessageId)
        );
        if (!streamedAssistantTexts.has(blockIndex)) {
          await emitTraceEvent({
            traceManager: input.traceManager,
            eventSink: input.eventSink,
            sessionId: session.sessionId,
            event: {
              kind: "assistant_text",
              turnCount,
              assistantMessageId,
              text: visibleText
            }
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
          const executed = await executeToolAction({
            sessionManager: input.sessionManager,
            routineRepository: input.routineRepository,
            toolRegistry: input.toolRegistry,
            traceManager: input.traceManager,
            session,
            turnCount,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolInput: toolCall.input as Record<string, JsonValue>,
            eventSink: input.eventSink,
            ...(input.abortSignal ? { abortSignal: input.abortSignal } : {})
          });
          session = executed.session;
          toolCallCount += 1;
          if (executed.kind === "permission_request") {
            return completeLocally({
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
          }

          toolResultCount += 1;
          toolOutputs.push(executed.output);

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
          return completeLocally({
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
        const finalAnswer = assistantTexts.join("\n").trim();
        if (session.context.pendingConfirmationPayload) {
          session = await input.sessionManager.updateContext(
            session.sessionId,
            {
              status: "waiting_for_conflict_confirmation"
            }
          );
          return completeLocally({
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
        return completeLocally({
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
    return result;
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
