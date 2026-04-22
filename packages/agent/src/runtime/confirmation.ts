import { randomUUID } from "node:crypto";

import type { RoutineRepository } from "@ai-app-template/db";

import type { RunEventSink } from "../events.js";
import type { SessionManager } from "../session.js";
import type { TraceManager } from "../trace.js";
import type {
  JsonValue,
  RunSessionResult,
  SessionSnapshot
} from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import {
  isAffirmativeConfirmationReply,
  isNegativeConfirmationReply,
  normalizeConfirmationReply
} from "./blocks.js";
import { completeLocally } from "./complete-run.js";
import { emitTraceEvent } from "./run-events.js";
import { executeToolAction } from "./tool-execution.js";

export async function handlePendingConfirmationReply(input: {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  traceManager: TraceManager | undefined;
  session: SessionSnapshot;
  message: string;
  pendingConfirmation: NonNullable<
    SessionSnapshot["context"]["pendingConfirmationPayload"]
  >;
  eventSink: RunEventSink | undefined;
}): Promise<RunSessionResult | null> {
  const normalized = normalizeConfirmationReply(input.message);
  const turnCount = 1;
  let session = await input.sessionManager.setTurnCount(
    input.session.sessionId,
    turnCount
  );

  if (
    !isAffirmativeConfirmationReply(normalized) &&
    !isNegativeConfirmationReply(normalized)
  ) {
    return null;
  }

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

  if (isNegativeConfirmationReply(normalized)) {
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_user_input",
      pendingConfirmationPayload: null,
      pendingConflictSummary: null
    });
    return completeLocally({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      session,
      turnCount,
      loopState: "waiting for input",
      finalAnswer: "好的，这次先不改动。告诉我新的时间或调整方案。",
      stopReason: "confirmation_rejected",
      toolCallCount: 0,
      toolResultCount: 0,
      toolOutputs: [],
      eventSink: input.eventSink
    });
  }

  let toolCallCount = 0;
  let toolResultCount = 0;
  const toolOutputs: RunSessionResult["toolOutputs"] = [];
  const invocations: Array<{
    toolName: string;
    toolInput: Record<string, JsonValue>;
  }> = [
    ...(input.pendingConfirmation.conflictItems ?? []).map((item) => ({
      toolName: "delete_routine",
      toolInput: {
        routine_id: item.routineId,
        reason: "user confirmed overwrite"
      } as Record<string, JsonValue>
    })),
    ...input.pendingConfirmation.proposedItems.flatMap((item) =>
      item.toolName && item.toolInput
        ? [
            {
              toolName: item.toolName,
              toolInput: item.toolInput as Record<string, JsonValue>
            }
          ]
        : []
    )
  ];

  if (invocations.length === 0) {
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_user_input",
      pendingConfirmationPayload: null,
      pendingConflictSummary: null
    });
    return completeLocally({
      sessionManager: input.sessionManager,
      traceManager: input.traceManager,
      session,
      turnCount,
      loopState: "waiting for input",
      finalAnswer: "已经收到确认，但当前没有可执行的调整。请直接告诉我新的安排。",
      stopReason: "confirmation_missing_actions",
      toolCallCount,
      toolResultCount,
      toolOutputs,
      eventSink: input.eventSink
    });
  }

  for (const invocation of invocations) {
    const executed = await executeToolAction({
      sessionManager: input.sessionManager,
      routineRepository: input.routineRepository,
      toolRegistry: input.toolRegistry,
      traceManager: input.traceManager,
      session,
      turnCount,
      toolCallId: `confirmation-${randomUUID()}`,
      toolName: invocation.toolName,
      toolInput: invocation.toolInput,
      eventSink: input.eventSink
    });
    session = executed.session;
    toolCallCount += 1;
    if (executed.kind !== "completed") {
      throw new Error(
        `Confirmation action ${invocation.toolName} unexpectedly paused for permission.`
      );
    }
    toolResultCount += 1;
    toolOutputs.push(executed.output);
  }

  session = await input.sessionManager.updateContext(session.sessionId, {
    status: "completed",
    pendingConfirmationPayload: null,
    pendingConflictSummary: null
  });

  const succeeded = toolOutputs.filter((item) => !item.isError);
  const failed = toolOutputs.filter((item) => item.isError);
  const lines = ["已按你的确认执行这些调整："];
  if (succeeded.length > 0) {
    lines.push(
      ...succeeded.map(
        (item) => `- ${item.displayText.split("\n")[1] ?? item.toolName}`
      )
    );
  }
  if (failed.length > 0) {
    lines.push(...failed.map((item) => `- 失败：${item.toolName}`));
  }

  return completeLocally({
    sessionManager: input.sessionManager,
    traceManager: input.traceManager,
    session,
    turnCount,
    loopState: "completed",
    finalAnswer: lines.join("\n"),
    stopReason: "confirmation_applied",
    toolCallCount,
    toolResultCount,
    toolOutputs,
    eventSink: input.eventSink
  });
}
