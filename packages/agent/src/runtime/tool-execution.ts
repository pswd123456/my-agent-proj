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
import type { ToolExecutionContext } from "../tools/runtime-tool.js";
import {
  buildToolCallBlock,
  buildToolResultBlock
} from "./blocks.js";
import { emitTraceEvent } from "./run-events.js";

function createToolExecutionContext(input: {
  session: SessionSnapshot;
  routineRepository: RoutineRepository;
  sessionManager: SessionManager;
}): ToolExecutionContext {
  return {
    sessionId: input.session.sessionId,
    userId: input.session.context.userId,
    workingDirectory: input.session.workingDirectory,
    routineRepository: input.routineRepository,
    sessionManager: input.sessionManager,
    sessionContext: {
      status: input.session.context.status,
      currentDateContext: input.session.context.currentDateContext
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
}): Promise<{
  session: SessionSnapshot;
  output: RunSessionResult["toolOutputs"][number];
}> {
  let session = await input.sessionManager.appendBlock(
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

  const result = await tool.execute(
    (validation.value ?? input.toolInput) as Record<string, JsonValue>,
    createToolExecutionContext({
      session,
      routineRepository: input.routineRepository,
      sessionManager: input.sessionManager
    })
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
    result.state === "failed" ? result.error ?? result.content : null
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
