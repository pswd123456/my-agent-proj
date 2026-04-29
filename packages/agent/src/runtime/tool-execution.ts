import type { RoutineRepository } from "@ai-app-template/db";

import type { RunEventSink } from "../events.js";
import type { BackgroundTaskManager } from "../background-tasks/index.js";
import type { DelegateAgentService } from "../delegation/index.js";
import type { SessionManager } from "../session.js";
import type { TraceManager } from "../trace.js";
import type { JsonValue, RunSessionResult, SessionSnapshot } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolExecutionContext } from "../tools/runtime-tool.js";
import { buildToolCallBlock, buildToolResultBlock } from "./blocks.js";
import { checkToolPermission } from "./permission-checker.js";
import { emitTraceEvent } from "./run-events.js";

export type ExecuteToolActionResult =
  | {
      kind: "completed";
      session: SessionSnapshot;
      output: RunSessionResult["toolOutputs"][number];
    }
  | {
      kind: "permission_request";
      session: SessionSnapshot;
      request: NonNullable<
        SessionSnapshot["context"]["pendingPermissionRequest"]
      >;
    };

function isYoloAutoAllowTool(
  tool: NonNullable<ReturnType<ToolRegistry["get"]>>,
  session: SessionSnapshot
): boolean {
  return (
    session.context.yoloMode &&
    tool.family !== "workspace-shell" &&
    tool.family !== "workspace-network"
  );
}

function createToolExecutionContext(input: {
  session: SessionSnapshot;
  routineRepository: RoutineRepository;
  sessionManager: SessionManager;
  delegateAgentService?: DelegateAgentService;
  backgroundTaskManager?: BackgroundTaskManager;
  tool: NonNullable<ReturnType<ToolRegistry["get"]>>;
  abortSignal?: AbortSignal;
  allowWorkspaceEscape?: boolean;
}): ToolExecutionContext {
  const workspaceEscapeAllowed =
    typeof input.allowWorkspaceEscape === "boolean"
      ? input.allowWorkspaceEscape
      : input.session.context.workspaceEscapeAllowed === true
        ? true
        : isYoloAutoAllowTool(input.tool, input.session);

  return {
    sessionId: input.session.sessionId,
    userId: input.session.context.userId,
    workingDirectory: input.session.workingDirectory,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    routineRepository: input.routineRepository,
    sessionManager: input.sessionManager,
    ...(input.delegateAgentService
      ? { delegateAgentService: input.delegateAgentService }
      : {}),
    ...(input.backgroundTaskManager
      ? { backgroundTaskManager: input.backgroundTaskManager }
      : {}),
    allowWorkspaceEscape: workspaceEscapeAllowed ?? false,
    permissionRules: {
      shellAllowPatterns: input.session.context.shellAllowPatterns ?? [],
      shellDenyPatterns: input.session.context.shellDenyPatterns ?? [],
      toolAllowList: input.session.context.toolAllowList ?? [],
      toolAskList: input.session.context.toolAskList ?? [],
      toolDenyList: input.session.context.toolDenyList ?? []
    },
    sessionMessages: input.session.messages,
    sessionContext: {
      status: input.session.context.status,
      currentDateContext: input.session.context.currentDateContext,
      yoloMode: input.session.context.yoloMode,
      planModeEnabled: input.session.context.planModeEnabled ?? false,
      taskBriefPath: input.session.context.taskBriefPath ?? null,
      workspaceEscapeAllowed:
        input.session.context.workspaceEscapeAllowed ?? false,
      shellAllowPatterns: input.session.context.shellAllowPatterns ?? [],
      shellDenyPatterns: input.session.context.shellDenyPatterns ?? [],
      toolAllowList: input.session.context.toolAllowList ?? [],
      toolAskList: input.session.context.toolAskList ?? [],
      toolDenyList: input.session.context.toolDenyList ?? [],
      todoState: input.session.context.todoState ?? null
    }
  };
}

export async function executeToolAction(input: {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  delegateAgentService?: DelegateAgentService;
  backgroundTaskManager?: BackgroundTaskManager;
  traceManager: TraceManager | undefined;
  session: SessionSnapshot;
  turnCount: number;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, JsonValue>;
  responseGroupId?: string;
  eventSink: RunEventSink | undefined;
  skipPermissionCheck?: boolean;
  skipAppendToolCall?: boolean;
  abortSignal?: AbortSignal;
  allowWorkspaceEscape?: boolean;
}): Promise<ExecuteToolActionResult> {
  let session = input.session;
  if (!(input.skipAppendToolCall ?? false)) {
    session = await input.sessionManager.appendBlock(
      input.session.sessionId,
      buildToolCallBlock({
        id: input.toolCallId,
        name: input.toolName,
        toolInput: input.toolInput,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {})
      })
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "tool_call",
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.toolInput
      }
    });
  }

  const tool = input.toolRegistry.get(input.toolName);
  if (!tool) {
    const errorText = `Unknown tool: ${input.toolName}`;
    session = await input.sessionManager.appendBlock(
      session.sessionId,
      buildToolResultBlock({
        id: input.toolCallId,
        name: input.toolName,
        content: errorText,
        isError: true,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {})
      })
    );
    session = await input.sessionManager.setLastError(
      session.sessionId,
      errorText
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "tool_result",
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        output: errorText,
        isError: true,
        displayText: `[${input.toolName}] failed\n- ${errorText}`
      }
    });
    return {
      kind: "completed",
      session,
      output: {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: errorText,
        displayText: `[${input.toolName}] failed\n- ${errorText}`,
        isError: true
      }
    };
  }

  const validation = tool.validate(input.toolInput);
  if (!validation.ok) {
    const validationText = JSON.stringify(
      {
        ok: false,
        code: "INVALID_TOOL_INPUT",
        message: "Tool input validation failed.",
        validationErrors: validation.issues ?? []
      },
      null,
      2
    );
    session = await input.sessionManager.appendBlock(
      session.sessionId,
      buildToolResultBlock({
        id: input.toolCallId,
        name: input.toolName,
        content: validationText,
        isError: true,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {})
      })
    );
    session = await input.sessionManager.setLastError(
      session.sessionId,
      "Tool input validation failed."
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "tool_result",
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        output: validationText,
        isError: true,
        displayText: `[${input.toolName}] invalid input`
      }
    });
    return {
      kind: "completed",
      session,
      output: {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: validationText,
        displayText: `[${input.toolName}] invalid input`,
        isError: true
      }
    };
  }

  const executionContext = createToolExecutionContext({
    session,
    routineRepository: input.routineRepository,
    sessionManager: input.sessionManager,
    ...(input.delegateAgentService
      ? { delegateAgentService: input.delegateAgentService }
      : {}),
    ...(input.backgroundTaskManager
      ? { backgroundTaskManager: input.backgroundTaskManager }
      : {}),
    tool,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(typeof input.allowWorkspaceEscape === "boolean"
      ? { allowWorkspaceEscape: input.allowWorkspaceEscape }
      : {})
  });
  const permissionCheck = input.skipPermissionCheck
    ? { decision: "allow" as const }
    : await checkToolPermission({
        toolCallId: input.toolCallId,
        tool,
        toolInput: (validation.value ?? input.toolInput) as Record<
          string,
          JsonValue
        >,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {}),
        executionContext
      });

  if (permissionCheck.decision === "block") {
    session = await input.sessionManager.appendBlock(
      session.sessionId,
      buildToolResultBlock({
        id: input.toolCallId,
        name: input.toolName,
        content: permissionCheck.content,
        isError: true,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {})
      })
    );
    session = await input.sessionManager.setLastError(
      session.sessionId,
      permissionCheck.reason
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "permission_blocked",
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        reason: permissionCheck.reason
      }
    });
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "tool_result",
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        output: permissionCheck.content,
        isError: true,
        displayText: permissionCheck.displayText
      }
    });
    return {
      kind: "completed",
      session,
      output: {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        content: permissionCheck.content,
        displayText: permissionCheck.displayText,
        isError: true
      }
    };
  }

  if (permissionCheck.decision === "ask_user") {
    const pendingToolCallIds =
      session.sessionState.pendingToolCallIds.length > 0
        ? [...session.sessionState.pendingToolCallIds]
        : [input.toolCallId];
    if (!pendingToolCallIds.includes(input.toolCallId)) {
      pendingToolCallIds.push(input.toolCallId);
    }
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_permission",
      pendingPermissionRequest: permissionCheck.request
    });
    session = await input.sessionManager.setPendingToolCallIds(
      session.sessionId,
      pendingToolCallIds
    );
    session = await input.sessionManager.setLastError(session.sessionId, null);
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "permission_request",
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        request: permissionCheck.request
      }
    });
    return {
      kind: "permission_request",
      session,
      request: permissionCheck.request
    };
  }

  const result = await tool.execute(
    (validation.value ?? input.toolInput) as Record<string, JsonValue>,
    executionContext
  );

  session = await input.sessionManager.appendBlock(
    session.sessionId,
    buildToolResultBlock({
      id: input.toolCallId,
      name: input.toolName,
      content: result.content,
      isError: result.state === "failed",
      ...(result.details ? { details: result.details } : {}),
      ...(input.responseGroupId
        ? { responseGroupId: input.responseGroupId }
        : {})
    })
  );
  session = await input.sessionManager.setLastError(
    session.sessionId,
    result.state === "failed" ? (result.error ?? result.content) : null
  );
  await emitTraceEvent({
    traceManager: input.traceManager,
    eventSink: input.eventSink,
    sessionId: session.sessionId,
    event: {
      kind: "tool_result",
      turnCount: input.turnCount,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      output: result.content,
      isError: result.state === "failed",
      displayText: result.displayText,
      ...(result.details ? { details: result.details } : {})
    }
  });

  return {
    kind: "completed",
    session,
    output: {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      content: result.content,
      displayText: result.displayText,
      isError: result.state === "failed",
      ...(result.details ? { details: result.details } : {})
    }
  };
}
