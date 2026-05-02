import type { PermissionRuleLists } from "@ai-app-template/domain";

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
import type { BackgroundTaskManager } from "../background-tasks/index.js";
import type { SessionManager } from "../session.js";
import type { Logger } from "../system-log.js";
import type { TraceManager } from "../trace.js";
import type { JsonValue, RunSessionResult, SessionSnapshot } from "../types.js";
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

const WORKSPACE_ESCAPE_APPROVAL_REPLY = "本会话允许 workspace 外文件操作";

export async function handlePendingPermissionReply(input: {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  backgroundTaskManager?: BackgroundTaskManager;
  traceManager: TraceManager | undefined;
  session: SessionSnapshot;
  message: string;
  permissionReply?: boolean;
  pendingPermissionRequest: NonNullable<
    SessionSnapshot["context"]["pendingPermissionRequest"]
  >;
  eventSink: RunEventSink | undefined;
  toolLogger?: Logger;
  permissionLogger?: Logger;
}): Promise<PendingPermissionReplyResult | null> {
  const normalized = normalizeConfirmationReply(input.message);
  const isWorkspaceEscapeRequest =
    input.pendingPermissionRequest.allowWorkspaceEscape === true;
  const isExplicitWorkspaceEscapeReply =
    isWorkspaceEscapeRequest &&
    normalized === WORKSPACE_ESCAPE_APPROVAL_REPLY;
  const isExplicitSessionApprovalReply =
    !isWorkspaceEscapeRequest &&
    (normalized.startsWith("本会话允许 shell:") ||
      normalized.startsWith("本会话允许 tool:"));

  if (
    !input.permissionReply &&
    !isAffirmativeConfirmationReply(normalized) &&
    !isNegativeConfirmationReply(normalized) &&
    !isExplicitWorkspaceEscapeReply &&
    !isExplicitSessionApprovalReply
  ) {
    return null;
  }

  const turnCount = Math.max(1, input.session.sessionState.turnCount);
  let session =
    input.session.sessionState.turnCount === turnCount
      ? input.session
      : await input.sessionManager.setTurnCount(input.session.sessionId, turnCount);

  if (isNegativeConfirmationReply(normalized)) {
    await input.permissionLogger?.info("permission_rejected", {
      toolCallId: input.pendingPermissionRequest.toolCallId,
      toolName: input.pendingPermissionRequest.toolName,
      allowWorkspaceEscape:
        input.pendingPermissionRequest.allowWorkspaceEscape ?? false,
      reply: normalized
    });
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
        isError: true,
        ...(input.pendingPermissionRequest.responseGroupId
          ? { responseGroupId: input.pendingPermissionRequest.responseGroupId }
          : {})
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
        finalAnswer:
          "好的，这次先不执行这个高风险操作。你可以换个更安全的路径，或者直接告诉我新的任务。",
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

  const approvalRules: PermissionRuleLists | null =
    isWorkspaceEscapeRequest
      ? null
      : normalized.startsWith("本会话允许 shell:")
        ? {
            shellAllowPatterns: [
              normalized.slice("本会话允许 shell:".length).trim()
            ],
            shellDenyPatterns: [],
            toolAllowList: [],
            toolAskList: [],
            toolDenyList: []
          }
        : normalized.startsWith("本会话允许 tool:")
          ? {
              shellAllowPatterns: [],
              shellDenyPatterns: [],
              toolAllowList: [normalized.slice("本会话允许 tool:".length).trim()],
              toolAskList: [],
              toolDenyList: []
            }
          : null;

  session = await input.sessionManager.updateContext(session.sessionId, {
    status: "running",
    pendingPermissionRequest: null,
    ...(isWorkspaceEscapeRequest ? { workspaceEscapeAllowed: true } : {})
  });
  session = await input.sessionManager.setLoopState(
    session.sessionId,
    "waiting for tool result"
  );
  if (approvalRules) {
    session = await input.sessionManager.updateContext(session.sessionId, {
      shellAllowPatterns: [
        ...new Set([
          ...(session.context.shellAllowPatterns ?? []),
          ...approvalRules.shellAllowPatterns
        ])
      ],
      shellDenyPatterns: [
        ...new Set([
          ...(session.context.shellDenyPatterns ?? []),
          ...approvalRules.shellDenyPatterns
        ])
      ],
      toolAllowList: [
        ...new Set([
          ...(session.context.toolAllowList ?? []),
          ...approvalRules.toolAllowList
        ])
      ],
      toolAskList: (session.context.toolAskList ?? []).filter(
        (item) => !approvalRules.toolAllowList.includes(item)
      ),
      toolDenyList: [
        ...new Set([
          ...(session.context.toolDenyList ?? []),
          ...approvalRules.toolDenyList
        ])
      ]
    });
  }
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
  await input.permissionLogger?.info("permission_approved", {
    toolCallId: input.pendingPermissionRequest.toolCallId,
    toolName: input.pendingPermissionRequest.toolName,
    allowWorkspaceEscape:
      input.pendingPermissionRequest.allowWorkspaceEscape ?? false,
    reply: normalized,
    grantedSessionShellPattern:
      approvalRules?.shellAllowPatterns[0] ?? null,
    grantedSessionTool: approvalRules?.toolAllowList[0] ?? null
  });

  const executed = await executeToolAction({
    sessionManager: input.sessionManager,
    routineRepository: input.routineRepository,
    toolRegistry: input.toolRegistry,
    ...(input.backgroundTaskManager
      ? { backgroundTaskManager: input.backgroundTaskManager }
      : {}),
    traceManager: input.traceManager,
    session,
    turnCount,
    toolCallId: input.pendingPermissionRequest.toolCallId,
    toolName: input.pendingPermissionRequest.toolName,
    toolInput: input.pendingPermissionRequest.toolInput as Record<
      string,
      JsonValue
    >,
    ...(input.pendingPermissionRequest.responseGroupId
      ? { responseGroupId: input.pendingPermissionRequest.responseGroupId }
      : {}),
    eventSink: input.eventSink,
    skipPermissionCheck: !isWorkspaceEscapeRequest,
    skipAppendToolCall: true,
    ...(input.pendingPermissionRequest.allowWorkspaceEscape
      ? { allowWorkspaceEscape: true }
      : {}),
    ...(input.toolLogger ? { toolLogger: input.toolLogger } : {}),
    ...(input.permissionLogger
      ? { permissionLogger: input.permissionLogger }
      : {})
  });

  if (executed.kind === "permission_request" && isWorkspaceEscapeRequest) {
    return {
      kind: "completed",
      result: await completeLocally({
        sessionManager: input.sessionManager,
        traceManager: input.traceManager,
        session: executed.session,
        turnCount,
        loopState: "waiting for input",
        finalAnswer: "",
        stopReason: "tool_use",
        toolCallCount: 0,
        toolResultCount: 0,
        toolOutputs: [],
        eventSink: input.eventSink,
        appendAssistantMessage: false,
        clearPendingToolCallIds: false
      })
    };
  }

  if (executed.kind !== "completed") {
    await input.permissionLogger?.error("permission_resume_failed", {
      toolCallId: input.pendingPermissionRequest.toolCallId,
      toolName: input.pendingPermissionRequest.toolName,
      reason: "approved_request_paused_again"
    });
    throw new Error(
      `Approved permission request for ${input.pendingPermissionRequest.toolName} unexpectedly paused again.`
    );
  }

  const shouldClearPendingToolCallIds =
    session.sessionState.pendingToolCallIds.length <= 1;
  if (shouldClearPendingToolCallIds) {
    session = await input.sessionManager.setPendingToolCallIds(
      session.sessionId,
      []
    );
  }
  session = await input.sessionManager.setLoopState(session.sessionId, "running");
  return {
    kind: "approved",
    session,
    toolResultCount: 1,
    toolOutputs: [executed.output]
  };
}
