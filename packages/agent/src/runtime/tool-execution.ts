import type { RoutineRepository } from "@ai-app-template/db";

import type { RunEventSink } from "../events.js";
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

function createToolExecutionContext(input: {
  session: SessionSnapshot;
  routineRepository: RoutineRepository;
  sessionManager: SessionManager;
  tool: ReturnType<ToolRegistry["get"]>;
  abortSignal?: AbortSignal;
  allowWorkspaceEscape?: boolean;
}): ToolExecutionContext {
  return {
    sessionId: input.session.sessionId,
    userId: input.session.context.userId,
    workingDirectory: input.session.workingDirectory,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    routineRepository: input.routineRepository,
    sessionManager: input.sessionManager,
    allowWorkspaceEscape:
      input.allowWorkspaceEscape ??
      input.tool?.sandboxProfile === "workspace-rooted",
    permissionRules: {
      shellAllowPatterns: input.session.context.shellAllowPatterns ?? [],
      shellDenyPatterns: input.session.context.shellDenyPatterns ?? [],
      toolAllowList: input.session.context.toolAllowList ?? [],
      toolAskList: input.session.context.toolAskList ?? [],
      toolDenyList: input.session.context.toolDenyList ?? []
    },
    sessionContext: {
      status: input.session.context.status,
      currentDateContext: input.session.context.currentDateContext,
      yoloMode: input.session.context.yoloMode,
      shellAllowPatterns: input.session.context.shellAllowPatterns ?? [],
      shellDenyPatterns: input.session.context.shellDenyPatterns ?? [],
      toolAllowList: input.session.context.toolAllowList ?? [],
      toolAskList: input.session.context.toolAskList ?? [],
      toolDenyList: input.session.context.toolDenyList ?? []
    }
  };
}

export async function executeToolAction(input: {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  toolRegistry: ToolRegistry;
  traceManager: TraceManager | undefined;
  session: SessionSnapshot;
  turnCount: number;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, JsonValue>;
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
        toolInput: input.toolInput
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
        isError: true
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
        isError: true
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
        executionContext
      });

  if (permissionCheck.decision === "block") {
    session = await input.sessionManager.appendBlock(
      session.sessionId,
      buildToolResultBlock({
        id: input.toolCallId,
        name: input.toolName,
        content: permissionCheck.content,
        isError: true
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
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_permission",
      pendingPermissionRequest: permissionCheck.request
    });
    session = await input.sessionManager.setPendingToolCallIds(
      session.sessionId,
      [input.toolCallId]
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
      isError: result.state === "failed"
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
      displayText: result.displayText
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
      isError: result.state === "failed"
    }
  };
}
