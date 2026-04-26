import type { ScheduleSessionContext } from "@ai-app-template/domain";

export type LoopState =
  | "running"
  | "interrupted"
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

export type WorkspaceFileChangeAction = "modify" | "create" | "delete";

export interface WorkspaceFileChangeSummary {
  path: string;
  action: WorkspaceFileChangeAction;
  addedLineCount: number;
  removedLineCount: number;
  diff: string;
}

export interface WorkspaceFileChangesToolResultDetails {
  kind: "workspace_file_changes";
  files: WorkspaceFileChangeSummary[];
}

export type ToolResultDetails = WorkspaceFileChangesToolResultDetails;

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
  responseGroupId?: string;
}

export interface AssistantThinkingConversationBlock extends BaseConversationBlock {
  kind: "assistant thinking";
  content: string;
  signature: string;
  responseGroupId?: string;
}

export interface ToolCallConversationBlock extends BaseConversationBlock {
  kind: "tool call";
  toolCallId: string;
  toolName: string;
  input: Record<string, JsonValue>;
  state: ToolState;
  responseGroupId?: string;
}

export interface ToolResultConversationBlock extends BaseConversationBlock {
  kind: "tool result";
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  state: ToolState;
  details?: ToolResultDetails;
  responseGroupId?: string;
}

export type ConversationBlock =
  | UserConversationBlock
  | AssistantConversationBlock
  | AssistantThinkingConversationBlock
  | ToolCallConversationBlock
  | ToolResultConversationBlock;

export interface SessionState {
  loopState: LoopState;
  turnCount: number;
  lastError: string | null;
  pendingToolCallIds: string[];
  interruptRequested: boolean;
  historyCompactionsSinceFullCompaction: number;
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
  planModeEnabled?: boolean;
  contextWindow?: number;
  maxTurns?: number;
  shellAllowPatterns?: string[];
  shellDenyPatterns?: string[];
  toolAllowList?: string[];
  toolAskList?: string[];
  toolDenyList?: string[];
  enabledCapabilityPacks?: string[];
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
  details?: ToolResultDetails;
}
