import type { RoutineRepository } from "@ai-app-template/db";

import {
  createRunCompleteEvent,
  createRunErrorEvent,
  type RunEventSink
} from "../events.js";
import type {
  AnthropicCompatibleClient,
  AnthropicToolChoice
} from "../model.js";
import {
  formatPromptDateTimeContext,
  resolvePromptTimeZone,
  type PromptBuilder
} from "../prompt.js";
import { discoverWorkspaceSkills } from "../skills/index.js";
import type { SessionManager } from "../session.js";
import type { TraceManager } from "../trace.js";
import type { JsonValue, RunSessionResult, SessionSnapshot } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import {
  buildAssistantBlockContent,
  buildFallbackAnswer,
  buildUserBlockContent,
  extractThinkingBlocks,
  extractToolCalls,
  renderPendingPermissionAnswer,
  renderPendingConfirmationAnswer
} from "./blocks.js";
import { completeLocally } from "./complete-run.js";
import { handlePendingConfirmationReply } from "./confirmation.js";
import { handlePendingPermissionReply } from "./permission.js";
import { emitRunEvent, emitTraceEvent } from "./run-events.js";
import { estimatePromptTokens } from "./token-budget.js";
import { executeToolAction } from "./tool-execution.js";

export async function runSessionLoop(input: {
  client: AnthropicCompatibleClient;
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  traceManager: TraceManager | undefined;
  promptBuilder: PromptBuilder;
  session: SessionSnapshot;
  message: string | undefined;
  permissionReply?: boolean;
  maxTurns: number;
  maxTokens: number | undefined;
  toolChoice: AnthropicToolChoice | undefined;
  eventSink: RunEventSink | undefined;
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

    for (let turn = carriedTurnCount; turn < input.maxTurns; turn += 1) {
      const turnCount = turn + 1;
      session = await input.sessionManager.saveSession(session);
      session = await input.sessionManager.setTurnCount(
        session.sessionId,
        turnCount
      );

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

      const response = await input.client.messages.create({
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
      });

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

      for (const thinkingBlock of extractThinkingBlocks(responseBlocks)) {
        await emitTraceEvent({
          traceManager: input.traceManager,
          eventSink: input.eventSink,
          sessionId: session.sessionId,
          event: {
            kind: "thinking",
            turnCount,
            text: thinkingBlock.text,
            signature: thinkingBlock.signature
          }
        });
      }

      const assistantTexts: string[] = [];
      const toolCalls = extractToolCalls(responseBlocks);

      for (const block of responseBlocks) {
        if (block.type !== "text") {
          continue;
        }

        assistantTexts.push(block.text);
        session = await input.sessionManager.appendBlock(
          session.sessionId,
          buildAssistantBlockContent(block.text)
        );
        await emitTraceEvent({
          traceManager: input.traceManager,
          eventSink: input.eventSink,
          sessionId: session.sessionId,
          event: {
            kind: "assistant_text",
            turnCount,
            text: block.text
          }
        });
      }

      if (toolCalls.length > 0) {
        session = await input.sessionManager.setLoopState(
          session.sessionId,
          "waiting for tool result"
        );
        session = await input.sessionManager.setPendingToolCallIds(
          session.sessionId,
          toolCalls.map((toolCall) => toolCall.id)
        );
        session = await input.sessionManager.setLastError(
          session.sessionId,
          null
        );

        for (const toolCall of toolCalls) {
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
            eventSink: input.eventSink
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
              finalAnswer: renderPendingPermissionAnswer(executed.request),
              stopReason: stopReason ?? "tool_use",
              toolCallCount,
              toolResultCount,
              toolOutputs,
              eventSink: input.eventSink,
              clearPendingToolCallIds: false
            });
          }

          toolResultCount += 1;
          toolOutputs.push(executed.output);
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
    const message = error instanceof Error ? error.message : String(error);
    session = await input.sessionManager.setLoopState(
      session.sessionId,
      "failed"
    );
    session = await input.sessionManager.setLastError(
      session.sessionId,
      message
    );
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
