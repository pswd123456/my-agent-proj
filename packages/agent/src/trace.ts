import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  HookContextEntry,
  PendingPermissionRequest,
  SessionBackgroundNotification,
  PendingUserQuestionPayload
} from "@ai-app-template/domain";

import type { AnthropicMessage, AnthropicToolChoice } from "./model.js";
import type {
  WorkspaceMcpConfigDiagnostic,
  WorkspaceMcpServerLoadSummary
} from "./mcp/index.js";
import type { PromptCompositionStats } from "./prompt.js";
import type {
  SkillDescriptor,
  SkillDiscoveryDiagnostic
} from "./skills/index.js";
import type {
  WorkspaceInstructionsDescriptor,
  WorkspaceInstructionsDiagnostic
} from "./workspace-instructions/index.js";
import type { ResolvedUserContextHookSection } from "./context-hooks.js";
import type { JsonValue, SessionSnapshot, ToolResultDetails } from "./types.js";

export interface TracePromptEvent {
  kind: "prompt";
  turnCount: number;
  system: string;
  prefixMessages: AnthropicMessage[];
  messages: AnthropicMessage[];
  runtimeContextMessages: AnthropicMessage[];
  requestMessages?: AnthropicMessage[];
  dynamicPromptMessages?: string[];
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  toolChoice: AnthropicToolChoice | null;
  cacheKey: string;
  compositionStats?: PromptCompositionStats;
}

export interface TraceResponseEvent {
  kind: "response";
  turnCount: number;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  content: JsonValue;
}

export interface TraceTurnStartEvent {
  kind: "turn_start";
  turnCount: number;
  session: Pick<
    SessionSnapshot,
    "sessionId" | "workingDirectory" | "model" | "sessionState"
  >;
}

export interface TraceSkillsLoadedEvent {
  kind: "skills_loaded";
  turnCount: number;
  skills: SkillDescriptor[];
  diagnostics: SkillDiscoveryDiagnostic[];
}

export interface TraceWorkspaceInstructionsLoadedEvent {
  kind: "workspace_instructions_loaded";
  turnCount: number;
  instructions: WorkspaceInstructionsDescriptor | null;
  diagnostics: WorkspaceInstructionsDiagnostic[];
}

export interface TraceContextHooksLoadedEvent {
  kind: "context_hooks_loaded";
  turnCount: number;
  userId: string;
  hooks: ResolvedUserContextHookSection[];
}

export interface TraceHookSubagentScheduledEvent {
  kind: "hook_subagent_scheduled";
  turnCount: number;
  taskId: string;
  hookId: string;
  hookEvent: "session_started" | "run_started" | "run_end";
  waitMode: "blocking" | "unblocking";
  configHash: string;
}

export interface TraceHookContextMaterializedEvent {
  kind: "hook_context_materialized";
  turnCount: number;
  notificationIds: string[];
  entries: HookContextEntry[];
}

export interface TraceMcpLoadedEvent {
  kind: "mcp_loaded";
  turnCount: number;
  configPath: string;
  foundConfig: boolean;
  diagnostics: WorkspaceMcpConfigDiagnostic[];
  servers: WorkspaceMcpServerLoadSummary[];
}

export interface TraceTextEvent {
  kind: "assistant_text";
  turnCount: number;
  assistantMessageId: string;
  text: string;
  delta?: string;
  snapshot?: string;
}

export interface TraceThinkingEvent {
  kind: "thinking";
  turnCount: number;
  thinkingMessageId?: string;
  text: string;
  signature: string;
  delta?: string;
  snapshot?: string;
}

export interface TraceToolCallEvent {
  kind: "tool_call";
  turnCount: number;
  toolCallId: string;
  toolName: string;
  input: Record<string, JsonValue>;
}

export interface TraceToolResultEvent {
  kind: "tool_result";
  turnCount: number;
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  displayText?: string;
  details?: ToolResultDetails;
}

export interface TracePermissionRequestEvent {
  kind: "permission_request";
  turnCount: number;
  toolCallId: string;
  toolName: string;
  request: PendingPermissionRequest;
}

export interface TracePermissionApprovedEvent {
  kind: "permission_approved";
  turnCount: number;
  toolCallId: string;
  toolName: string;
  request: PendingPermissionRequest;
}

export interface TracePermissionRejectedEvent {
  kind: "permission_rejected";
  turnCount: number;
  toolCallId: string;
  toolName: string;
  request: PendingPermissionRequest;
}

export interface TracePermissionBlockedEvent {
  kind: "permission_blocked";
  turnCount: number;
  toolCallId: string;
  toolName: string;
  reason: string;
}

export interface TraceUserQuestionRequestEvent {
  kind: "user_question_request";
  turnCount: number;
  question: PendingUserQuestionPayload;
}

export interface TraceBackgroundNotificationEvent {
  kind: "background_notification";
  turnCount: number;
  notification: SessionBackgroundNotification;
}

export interface TraceBackgroundNotificationConsumedEvent {
  kind: "background_notification_consumed";
  turnCount: number;
  notification: SessionBackgroundNotification;
}

export interface TraceInterruptRequestedEvent {
  kind: "interrupt_requested";
  turnCount: number;
}

export interface TraceInterruptedEvent {
  kind: "interrupted";
  turnCount: number;
  stopReason: "interrupted_by_user";
}

export interface TraceFallbackEvent {
  kind: "fallback";
  turnCount: number;
  reason: string;
  summary: string;
}

export interface TraceHistoryCompactionEvent {
  kind: "history_compaction";
  turnCount: number;
  thresholdTokens: number;
  estimatedInputTokensBefore: number;
  estimatedInputTokensAfter: number;
  sourceBlockCount: number;
  retainedTailCount: number;
}

export interface TraceFullCompactionEvent {
  kind: "full_compaction";
  turnCount: number;
  thresholdTokens: number;
  estimatedInputTokensBefore: number;
  estimatedInputTokensAfter: number;
  sourceBlockCount: number;
  retainedTailCount: number;
  promptVersion: string;
  summaryMarkdown: string;
}

export interface TraceTurnEndEvent {
  kind: "turn_end";
  turnCount: number;
  loopState: SessionSnapshot["sessionState"]["loopState"];
}

export interface TraceRunErrorEvent {
  kind: "run_error";
  turnCount: number;
  error: string;
  stopReason: string | null;
  loopState: SessionSnapshot["sessionState"]["loopState"];
  contextStatus: SessionSnapshot["context"]["status"];
  pendingToolCallIds: string[];
  stack?: string;
}

export type TraceEvent =
  | TracePromptEvent
  | TraceResponseEvent
  | TraceTurnStartEvent
  | TraceSkillsLoadedEvent
  | TraceWorkspaceInstructionsLoadedEvent
  | TraceContextHooksLoadedEvent
  | TraceHookSubagentScheduledEvent
  | TraceHookContextMaterializedEvent
  | TraceMcpLoadedEvent
  | TraceTextEvent
  | TraceThinkingEvent
  | TraceToolCallEvent
  | TraceToolResultEvent
  | TracePermissionRequestEvent
  | TracePermissionApprovedEvent
  | TracePermissionRejectedEvent
  | TracePermissionBlockedEvent
  | TraceUserQuestionRequestEvent
  | TraceBackgroundNotificationEvent
  | TraceBackgroundNotificationConsumedEvent
  | TraceInterruptRequestedEvent
  | TraceInterruptedEvent
  | TraceFallbackEvent
  | TraceHistoryCompactionEvent
  | TraceFullCompactionEvent
  | TraceTurnEndEvent
  | TraceRunErrorEvent;

export interface TraceRecord {
  sessionId: string;
  createdAt: string;
  runId?: string;
  event: TraceEvent;
}

export interface TraceAppendOptions {
  runId?: string;
}

export interface TraceManager {
  appendEvent(
    sessionId: string,
    event: TraceEvent,
    options?: TraceAppendOptions
  ): Promise<void>;
  readEvents(sessionId: string): Promise<TraceRecord[]>;
  deleteEvents(sessionId: string): Promise<void>;
  truncateEventsAfterTurn(sessionId: string, turnCount: number): Promise<void>;
}

export class FileTraceManager implements TraceManager {
  constructor(private readonly baseDirectory: string) {}

  private get tracesDirectory(): string {
    return path.resolve(this.baseDirectory, "sessions");
  }

  private tracePath(sessionId: string): string {
    return path.join(this.tracesDirectory, `${sessionId}.trace.jsonl`);
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.tracesDirectory, { recursive: true });
  }

  async appendEvent(
    sessionId: string,
    event: TraceEvent,
    options?: TraceAppendOptions
  ): Promise<void> {
    await this.ensureDirectories();
    const record: TraceRecord = {
      sessionId,
      createdAt: new Date().toISOString(),
      ...(options?.runId ? { runId: options.runId } : {}),
      event: structuredClone(event)
    };

    await fs.appendFile(
      this.tracePath(sessionId),
      `${JSON.stringify(record)}\n`,
      "utf8"
    );
  }

  async readEvents(sessionId: string): Promise<TraceRecord[]> {
    try {
      const raw = await fs.readFile(this.tracePath(sessionId), "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as TraceRecord;
            if (
              parsed &&
              typeof parsed.sessionId === "string" &&
              typeof parsed.createdAt === "string" &&
              (parsed.runId === undefined || typeof parsed.runId === "string") &&
              typeof parsed.event === "object" &&
              parsed.event !== null
            ) {
              return [parsed];
            }
          } catch {
            return [];
          }

          return [];
        });
    } catch {
      return [];
    }
  }

  async deleteEvents(sessionId: string): Promise<void> {
    try {
      await fs.unlink(this.tracePath(sessionId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async truncateEventsAfterTurn(
    sessionId: string,
    turnCount: number
  ): Promise<void> {
    const records = await this.readEvents(sessionId);
    const cutoff = Math.max(0, Math.floor(turnCount));
    const retained = records.filter((record) => {
      const eventTurnCount =
        typeof record.event.turnCount === "number" ? record.event.turnCount : -1;
      return eventTurnCount < cutoff;
    });

    if (retained.length === 0) {
      await this.deleteEvents(sessionId);
      return;
    }

    await this.ensureDirectories();
    await fs.writeFile(
      this.tracePath(sessionId),
      `${retained.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8"
    );
  }
}

export function createFileTraceManager(
  baseDirectory: string
): FileTraceManager {
  return new FileTraceManager(baseDirectory);
}

class RunScopedTraceManager implements TraceManager {
  constructor(
    private readonly traceManager: TraceManager,
    private readonly runId: string
  ) {}

  appendEvent(
    sessionId: string,
    event: TraceEvent,
    options?: TraceAppendOptions
  ): Promise<void> {
    return this.traceManager.appendEvent(sessionId, event, {
      ...options,
      runId: options?.runId ?? this.runId
    });
  }

  readEvents(sessionId: string): Promise<TraceRecord[]> {
    return this.traceManager.readEvents(sessionId);
  }

  deleteEvents(sessionId: string): Promise<void> {
    return this.traceManager.deleteEvents(sessionId);
  }

  truncateEventsAfterTurn(sessionId: string, turnCount: number): Promise<void> {
    return this.traceManager.truncateEventsAfterTurn(sessionId, turnCount);
  }
}

export function createRunScopedTraceManager(
  traceManager: TraceManager | undefined,
  runId: string
): TraceManager | undefined {
  if (!traceManager) {
    return undefined;
  }

  return new RunScopedTraceManager(traceManager, runId);
}
