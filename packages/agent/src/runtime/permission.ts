import { createToolResult } from "../tools/tool-result.js";
import {
  buildToolResultBlock,
  isAffirmativeConfirmationReply,
  isNegativeConfirmationReply,
  normalizeConfirmationReply
} from "./blocks.js";
import { completeLocally } from "./complete-run.js";
import { emitTraceEvent } from "./run-events.js";
import { executeToolAction } from "./tool-execution.js";

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

export type PendingPermissionReplyResult =
  | {
      kind: "approved";
      session: SessionSnapshot;
      toolResultCount: number;
      toolOutputs: RunSessionResult["toolOutputs"];
    }
  | {
      kind: "completed";
      result: RunSessionResult;
    };

export async function handlePendingPermissionReply(input: {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  traceManager: TraceManager | undefined;
  session: SessionSnapshot;
  message: string;
  pendingPermissionRequest: NonNullable<
    SessionSnapshot["context"]["pendingPermissionRequest"]
  >;
  eventSink: RunEventSink | undefined;
}): Promise<PendingPermissionReplyResult | null> {
  const normalized = normalizeConfirmationReply(input.message);
  if (
    !isAffirmativeConfirmationReply(normalized) &&
    !isNegativeConfirmationReply(normalized)
  ) {
    return null;
  }

  const turnCount = 1;
  let session = input.session;

  if (isNegativeConfirmationReply(normalized)) {
    const denialContent = JSON.stringify(
      createToolResult({
        ok: false,
        code: "PERMISSION_REJECTED",
        message: "User rejected the pending permission request."
      }),
      null,
      2
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "permission_rejected",
        turnCount,
        toolCallId: input.pendingPermissionRequest.toolCallId,
        toolName: input.pendingPermissionRequest.toolName,
        request: input.pendingPermissionRequest
      }
    });
    session = await input.sessionManager.appendBlock(
      session.sessionId,
      buildToolResultBlock({
        id: input.pendingPermissionRequest.toolCallId,
        name: input.pendingPermissionRequest.toolName,
        content: denialContent,
        isError: true
      })
    );
    session = await input.sessionManager.setLastError(
      session.sessionId,
      "User rejected the pending permission request."
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "tool_result",
        turnCount,
        toolCallId: input.pendingPermissionRequest.toolCallId,
        toolName: input.pendingPermissionRequest.toolName,
        output: denialContent,
        isError: true,
        displayText: `[${input.pendingPermissionRequest.toolName}] rejected\n- permission denied by user`
      }
    });
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_user_input",
      pendingPermissionRequest: null
    });

    return {
      kind: "completed",
      result: await completeLocally({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        session,
        turnCount,
        loopState: "waiting for input",
        finalAnswer: "好的，这次先不执行这个高风险操作。你可以换个更安全的路径，或者直接告诉我新的任务。",
        stopReason: "permission_rejected",
        toolCallCount: 0,
        toolResultCount: 1,
        toolOutputs: [
          {
            toolCallId: input.pendingPermissionRequest.toolCallId,
            toolName: input.pendingPermissionRequest.toolName,
            content: denialContent,
            displayText: `[${input.pendingPermissionRequest.toolName}] rejected\n- permission denied by user`,
            isError: true
          }
        ],
        eventSink: input.eventSink
      })
    };
  }

  session = await input.sessionManager.updateContext(session.sessionId, {
    status: "running",
    pendingPermissionRequest: null
  });
  await emitTraceEvent({
    traceManager: input.traceManager,
    eventSink: input.eventSink,
    sessionId: session.sessionId,
    event: {
      kind: "permission_approved",
      turnCount,
      toolCallId: input.pendingPermissionRequest.toolCallId,
      toolName: input.pendingPermissionRequest.toolName,
      request: input.pendingPermissionRequest
    }
  });

  const executed = await executeToolAction({
    sessionManager: input.sessionManager,
    routineRepository: input.routineRepository,
    toolRegistry: input.toolRegistry,
    traceManager: input.traceManager,
    session,
    turnCount,
    toolCallId: input.pendingPermissionRequest.toolCallId,
    toolName: input.pendingPermissionRequest.toolName,
    toolInput:
      input.pendingPermissionRequest.toolInput as Record<string, JsonValue>,
    eventSink: input.eventSink,
    skipPermissionCheck: true,
    skipAppendToolCall: true
  });

  if (executed.kind !== "completed") {
    throw new Error(
      `Approved permission request for ${input.pendingPermissionRequest.toolName} unexpectedly paused again.`
    );
  }

  session = await input.sessionManager.setPendingToolCallIds(session.sessionId, []);
  return {
    kind: "approved",
    session,
    toolResultCount: 1,
    toolOutputs: [executed.output]
  };
}
