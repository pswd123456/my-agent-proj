import type { CronJobRepository, RoutineRepository } from "@ai-app-template/db";

import type { RunEventSink } from "../events.js";
import type { BackgroundTaskManager } from "../background-tasks/index.js";
import type { DelegateAgentService } from "../delegation/index.js";
import type { SessionManager } from "../session.js";
import type { Logger } from "../system-log.js";
import type { TraceEvent, TraceManager } from "../trace.js";
import type {
  JsonValue,
  RunSessionResult,
  SessionSnapshot,
  ToolResultDetails
} from "../types.js";
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

export interface ToolActionCompletion {
  toolCallId: string;
  toolName: string;
  responseGroupId?: string;
  output: RunSessionResult["toolOutputs"][number];
  lastError: string | null;
  traceEvents: TraceEvent[];
}

export interface PreparedToolActionReady {
  kind: "ready";
  isConcurrencySafe: boolean;
  execute(): Promise<ToolActionCompletion>;
}

export type PreparedToolAction =
  | PreparedToolActionReady
  | {
      kind: "completed";
      completion: ToolActionCompletion;
    }
  | {
      kind: "permission_request";
      request: NonNullable<
        SessionSnapshot["context"]["pendingPermissionRequest"]
      >;
    };

function getToolInputKeys(toolInput: Record<string, JsonValue>): string[] {
  return Object.keys(toolInput).sort();
}

function summarizePermissionRequest(
  request: NonNullable<SessionSnapshot["context"]["pendingPermissionRequest"]>
): JsonValue {
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    family: request.family,
    permissionProfile: request.permissionProfile,
    summaryText: request.summaryText,
    allowWorkspaceEscape: request.allowWorkspaceEscape ?? false,
    inputKeys: getToolInputKeys(request.toolInput as Record<string, JsonValue>)
  };
}

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
  cronJobRepository?: CronJobRepository;
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
    workingDirectory: input.session.workingDirectory,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    routineRepository: input.routineRepository,
    ...(input.cronJobRepository
      ? { cronJobRepository: input.cronJobRepository }
      : {}),
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

function buildToolActionCompletion(input: {
  turnCount: number;
  toolCallId: string;
  toolName: string;
  responseGroupId?: string;
  content: string;
  isError: boolean;
  displayText: string;
  details?: ToolResultDetails;
  lastError: string | null;
  traceEvents?: TraceEvent[];
}): ToolActionCompletion {
  const toolResultEvent: TraceEvent = {
    kind: "tool_result",
    turnCount: input.turnCount,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    output: input.content,
    isError: input.isError,
    displayText: input.displayText,
    ...(input.details ? { details: input.details } : {})
  };

  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ...(input.responseGroupId
      ? { responseGroupId: input.responseGroupId }
      : {}),
    output: {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      content: input.content,
      displayText: input.displayText,
      isError: input.isError,
      ...(input.details ? { details: input.details } : {})
    },
    lastError: input.lastError,
    traceEvents: [...(input.traceEvents ?? []), toolResultEvent]
  };
}

function resolveConcurrencySafety(input: {
  tool: NonNullable<ReturnType<ToolRegistry["get"]>>;
  toolInput: Record<string, JsonValue>;
  executionContext: ToolExecutionContext;
}): boolean {
  if (typeof input.tool.isConcurrencySafe === "function") {
    try {
      return input.tool.isConcurrencySafe(
        input.toolInput,
        input.executionContext
      );
    } catch {
      return false;
    }
  }

  return input.tool.isReadOnly;
}

export async function persistToolActionCompletion(input: {
  sessionManager: SessionManager;
  traceManager: TraceManager | undefined;
  eventSink: RunEventSink | undefined;
  session: SessionSnapshot;
  completion: ToolActionCompletion;
  toolLogger?: Logger;
}): Promise<SessionSnapshot> {
  let session = await input.sessionManager.appendBlock(
    input.session.sessionId,
    buildToolResultBlock({
      id: input.completion.toolCallId,
      name: input.completion.toolName,
      content: input.completion.output.content,
      isError: input.completion.output.isError,
      ...(input.completion.output.details
        ? { details: input.completion.output.details }
        : {}),
      ...(input.completion.responseGroupId
        ? { responseGroupId: input.completion.responseGroupId }
        : {})
    })
  );
  session = await input.sessionManager.setLastError(
    session.sessionId,
    input.completion.lastError
  );

  for (const event of input.completion.traceEvents) {
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event
    });
  }

  await input.toolLogger?.[input.completion.output.isError ? "warn" : "info"](
    "tool_finished",
    {
      toolCallId: input.completion.toolCallId,
      toolName: input.completion.toolName,
      responseGroupId: input.completion.responseGroupId ?? null,
      isError: input.completion.output.isError,
      displayText: input.completion.output.displayText,
      lastError: input.completion.lastError,
      detailsKind: input.completion.output.details?.kind ?? null
    }
  );

  return session;
}

export async function prepareToolAction(input: {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  cronJobRepository?: CronJobRepository;
  toolRegistry: ToolRegistry;
  delegateAgentService?: DelegateAgentService;
  backgroundTaskManager?: BackgroundTaskManager;
  session: SessionSnapshot;
  turnCount: number;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, JsonValue>;
  responseGroupId?: string;
  skipPermissionCheck?: boolean;
  abortSignal?: AbortSignal;
  allowWorkspaceEscape?: boolean;
  toolLogger?: Logger;
  permissionLogger?: Logger;
}): Promise<PreparedToolAction> {
  await input.toolLogger?.info("tool_started", {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    responseGroupId: input.responseGroupId ?? null,
    inputKeys: getToolInputKeys(input.toolInput),
    skipPermissionCheck: input.skipPermissionCheck ?? false,
    allowWorkspaceEscape: input.allowWorkspaceEscape ?? null
  });

  const tool = input.toolRegistry.get(input.toolName);
  if (!tool) {
    const errorText = `Unknown tool: ${input.toolName}`;
    await input.toolLogger?.warn("tool_resolution_failed", {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      reason: errorText
    });
    return {
      kind: "completed",
      completion: buildToolActionCompletion({
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {}),
        content: errorText,
        isError: true,
        displayText: `[${input.toolName}] failed\n- ${errorText}`,
        lastError: errorText
      })
    };
  }

  const validation = tool.validate(input.toolInput);
  if (!validation.ok) {
    await input.toolLogger?.warn("tool_validation_failed", {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      inputKeys: getToolInputKeys(input.toolInput),
      validationErrors: (validation.issues ?? []).map((issue) => ({
        field: issue.field,
        issue: issue.issue
      }))
    });
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
    return {
      kind: "completed",
      completion: buildToolActionCompletion({
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {}),
        content: validationText,
        isError: true,
        displayText: `[${input.toolName}] invalid input`,
        lastError: "Tool input validation failed."
      })
    };
  }

  const validatedInput = (validation.value ?? input.toolInput) as Record<
    string,
    JsonValue
  >;
  const executionContext = createToolExecutionContext({
    session: input.session,
    routineRepository: input.routineRepository,
    ...(input.cronJobRepository
      ? { cronJobRepository: input.cronJobRepository }
      : {}),
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
        toolInput: validatedInput,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {}),
        executionContext
      });

  if (permissionCheck.decision === "block") {
    await input.permissionLogger?.warn("permission_blocked", {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      family: tool.family,
      permissionProfile: tool.permissionProfile,
      reason: permissionCheck.reason
    });
    return {
      kind: "completed",
      completion: buildToolActionCompletion({
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {}),
        content: permissionCheck.content,
        isError: true,
        displayText: permissionCheck.displayText,
        lastError: permissionCheck.reason,
        traceEvents: [
          {
            kind: "permission_blocked",
            turnCount: input.turnCount,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            reason: permissionCheck.reason
          }
        ]
      })
    };
  }

  if (permissionCheck.decision === "ask_user") {
    await input.permissionLogger?.info(
      "permission_requested",
      summarizePermissionRequest(permissionCheck.request)
    );
    return {
      kind: "permission_request",
      request: permissionCheck.request
    };
  }

  await input.permissionLogger?.debug("permission_allowed", {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    family: tool.family,
    permissionProfile: tool.permissionProfile,
    skipped: input.skipPermissionCheck ?? false
  });

  return {
    kind: "ready",
    isConcurrencySafe: resolveConcurrencySafety({
      tool,
      toolInput: validatedInput,
      executionContext
    }),
    async execute() {
      await input.toolLogger?.info("tool_execution_started", {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        family: tool.family,
        isReadOnly: tool.isReadOnly,
        hasExternalSideEffect: tool.hasExternalSideEffect
      });

      let result: Awaited<ReturnType<typeof tool.execute>>;
      try {
        result = await tool.execute(validatedInput, executionContext);
      } catch (error) {
        await input.toolLogger?.error("tool_execution_threw", {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      return buildToolActionCompletion({
        turnCount: input.turnCount,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        ...(input.responseGroupId
          ? { responseGroupId: input.responseGroupId }
          : {}),
        content: result.content,
        isError: result.state === "failed",
        displayText: result.displayText,
        ...(result.details ? { details: result.details } : {}),
        lastError:
          result.state === "failed" ? (result.error ?? result.content) : null
      });
    }
  };
}

export async function executeToolAction(input: {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  cronJobRepository?: CronJobRepository;
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
  toolLogger?: Logger;
  permissionLogger?: Logger;
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

  const prepared = await prepareToolAction({
    sessionManager: input.sessionManager,
    routineRepository: input.routineRepository,
    ...(input.cronJobRepository
      ? { cronJobRepository: input.cronJobRepository }
      : {}),
    toolRegistry: input.toolRegistry,
    ...(input.delegateAgentService
      ? { delegateAgentService: input.delegateAgentService }
      : {}),
    ...(input.backgroundTaskManager
      ? { backgroundTaskManager: input.backgroundTaskManager }
      : {}),
    session,
    turnCount: input.turnCount,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    toolInput: input.toolInput,
    ...(input.responseGroupId
      ? { responseGroupId: input.responseGroupId }
      : {}),
    ...(input.skipPermissionCheck
      ? { skipPermissionCheck: input.skipPermissionCheck }
      : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(typeof input.allowWorkspaceEscape === "boolean"
      ? { allowWorkspaceEscape: input.allowWorkspaceEscape }
      : {}),
    ...(input.toolLogger ? { toolLogger: input.toolLogger } : {}),
    ...(input.permissionLogger
      ? { permissionLogger: input.permissionLogger }
      : {})
  });

  if (prepared.kind === "permission_request") {
    const pendingToolCallIds =
      session.sessionState.pendingToolCallIds.length > 0
        ? [...session.sessionState.pendingToolCallIds]
        : [input.toolCallId];
    if (!pendingToolCallIds.includes(input.toolCallId)) {
      pendingToolCallIds.push(input.toolCallId);
    }
    session = await input.sessionManager.updateContext(session.sessionId, {
      status: "waiting_for_permission",
      pendingPermissionRequest: prepared.request
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
        request: prepared.request
      }
    });
    return {
      kind: "permission_request",
      session,
      request: prepared.request
    };
  }

  const completion =
    prepared.kind === "completed"
      ? prepared.completion
      : await prepared.execute();
  session = await persistToolActionCompletion({
    sessionManager: input.sessionManager,
    traceManager: input.traceManager,
    eventSink: input.eventSink,
    session,
    completion,
    ...(input.toolLogger ? { toolLogger: input.toolLogger } : {})
  });

  return {
    kind: "completed",
    session,
    output: completion.output
  };
}
