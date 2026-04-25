import { promises as fs } from "node:fs";
import path from "node:path";

import type { PendingPermissionRequest } from "@ai-app-template/domain";

import type { AnthropicMessage, AnthropicToolChoice } from "./model.js";
import type {
  WorkspaceMcpConfigDiagnostic,
  WorkspaceMcpServerLoadSummary
} from "./mcp/index.js";
import type {
  SkillDescriptor,
  SkillDiscoveryDiagnostic
} from "./skills/index.js";
import type { JsonValue, SessionSnapshot } from "./types.js";

export interface TracePromptEvent {
  kind: "prompt";
  turnCount: number;
  system: string;
  prefixMessages: AnthropicMessage[];
  messages: AnthropicMessage[];
  runtimeContextMessages: AnthropicMessage[];
  dynamicPromptMessages?: string[];
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  toolChoice: AnthropicToolChoice | null;
  cacheKey: string;
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
  | TraceMcpLoadedEvent
  | TraceTextEvent
  | TraceThinkingEvent
  | TraceToolCallEvent
  | TraceToolResultEvent
  | TracePermissionRequestEvent
  | TracePermissionApprovedEvent
  | TracePermissionRejectedEvent
  | TracePermissionBlockedEvent
  | TraceInterruptRequestedEvent
  | TraceInterruptedEvent
  | TraceFallbackEvent
  | TraceTurnEndEvent
  | TraceRunErrorEvent;

export interface TraceRecord {
  sessionId: string;
  createdAt: string;
  event: TraceEvent;
}

export interface TraceManager {
  appendEvent(sessionId: string, event: TraceEvent): Promise<void>;
  readEvents(sessionId: string): Promise<TraceRecord[]>;
  deleteEvents(sessionId: string): Promise<void>;
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

  async appendEvent(sessionId: string, event: TraceEvent): Promise<void> {
    await this.ensureDirectories();
    const record: TraceRecord = {
      sessionId,
      createdAt: new Date().toISOString(),
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
}

export function createFileTraceManager(
  baseDirectory: string
): FileTraceManager {
  return new FileTraceManager(baseDirectory);
}
