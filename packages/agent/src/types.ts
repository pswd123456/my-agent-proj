import type { ScheduleSessionContext } from "@ai-app-template/domain";

export type LoopState =
  | "running"
  | "interrupted"
  | "idle"
  | "completed"
  | "waiting for input"
  | "waiting for tool result"
  | "failed";

export type ToolState = "pending" | "success" | "failed";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface BaseConversationBlock {
  id: string;
  createdAt: string;
}

export interface UserConversationBlock extends BaseConversationBlock {
  kind: "user";
  content: string;
}

export interface AssistantConversationBlock extends BaseConversationBlock {
  kind: "assistant";
  content: string;
}

export interface ToolCallConversationBlock extends BaseConversationBlock {
  kind: "tool call";
  toolCallId: string;
  toolName: string;
  input: Record<string, JsonValue>;
  state: ToolState;
}

export interface ToolResultConversationBlock extends BaseConversationBlock {
  kind: "tool result";
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  state: ToolState;
}

export type ConversationBlock =
  | UserConversationBlock
  | AssistantConversationBlock
  | ToolCallConversationBlock
  | ToolResultConversationBlock;

export interface SessionState {
  loopState: LoopState;
  turnCount: number;
  lastError: string | null;
  pendingToolCallIds: string[];
  interruptRequested: boolean;
}

export interface SessionSnapshot {
  sessionId: string;
  workingDirectory: string;
  model: string;
  contextWindow: number;
  maxTurns: number;
  context: ScheduleSessionContext;
  messages: ConversationBlock[];
  sessionState: SessionState;
  inputTokensCount: number;
  promptCacheKey: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  workingDirectory?: string;
  model?: string;
  userId?: string;
  yoloMode?: boolean;
  contextWindow?: number;
  maxTurns?: number;
  shellAllowPatterns?: string[];
  shellDenyPatterns?: string[];
  toolAllowList?: string[];
  toolAskList?: string[];
  toolDenyList?: string[];
}

export interface RunSessionInput {
  sessionId: string;
  message?: string;
  maxTurns?: number;
  permissionReply?: boolean;
}

export interface RunSessionResult {
  session: SessionSnapshot;
  finalAnswer: string | null;
  status: LoopState;
  stopReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
  toolOutputs: ToolOutputSummary[];
}

export interface ToolOutputSummary {
  toolCallId: string;
  toolName: string;
  content: string;
  displayText: string;
  isError: boolean;
}
