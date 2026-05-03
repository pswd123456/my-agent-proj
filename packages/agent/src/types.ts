import type {
  BackgroundTaskKind,
  ScheduleSessionContext,
  ThinkingEffort,
  UserContextHookEvent
} from "@ai-app-template/domain";
import type {
  AnthropicMessage,
  AnthropicToolChoice,
  AnthropicToolDefinition
} from "./model.js";
import { z } from "zod";

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

export const workspaceFileChangeActionSchema = z.enum([
  "modify",
  "create",
  "delete"
]);

export type WorkspaceFileChangeAction = z.infer<
  typeof workspaceFileChangeActionSchema
>;

export const workspaceFileChangeSummarySchema = z.object({
  path: z.string().min(1),
  action: workspaceFileChangeActionSchema,
  addedLineCount: z.number().int().min(0),
  removedLineCount: z.number().int().min(0),
  diff: z.string().min(1)
});

export type WorkspaceFileChangeSummary = z.infer<
  typeof workspaceFileChangeSummarySchema
>;

export interface WorkspaceFileChangesToolResultDetails {
  kind: "workspace_file_changes";
  files: WorkspaceFileChangeSummary[];
}

export interface TaskBriefToolResultDetails {
  kind: "task_brief";
  path: string;
  content: string;
  operation: "replace" | "edit";
  startLine?: number;
  endLine?: number;
}

export type ToolResultDetails =
  | WorkspaceFileChangesToolResultDetails
  | TaskBriefToolResultDetails;

export interface BaseConversationBlock {
  id: string;
  createdAt: string;
}

export type UserConversationSource = "user" | "hook_message";

export interface UserConversationBlock extends BaseConversationBlock {
  kind: "user";
  content: string;
  source?: UserConversationSource;
  hookEvent?: UserContextHookEvent;
  hookTitle?: string;
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
  cronJobId?: string | null;
  parentSessionId?: string | null;
  parentRelationKind?: SessionParentRelationKind | null;
  parentSessionTaskKind?: BackgroundTaskKind | null;
  forkReplayCheckpointId?: string | null;
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
  cronJobId?: string | null;
  parentSessionId?: string | null;
  parentRelationKind?: SessionParentRelationKind | null;
  forkReplayCheckpointId?: string | null;
  workingDirectory?: string;
  model?: string;
  thinkingEffort?: ThinkingEffort;
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
  skipSubagentHooks?: boolean;
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

export type SessionParentRelationKind = "fork" | "subagent" | "hook_subagent";

export interface SessionForkCheckpointPromptSeed {
  system: string;
  requestMessages: AnthropicMessage[];
  runtimeContextMessages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  toolChoice: AnthropicToolChoice | null;
}

export interface SessionForkCheckpoint {
  id: string;
  sessionId: string;
  assistantMessageId: string;
  turnCount: number;
  baseMessageCount: number;
  responseGroupId?: string | null;
  snapshot: SessionSnapshot;
  promptSeed: SessionForkCheckpointPromptSeed;
  createdAt: string;
  updatedAt: string;
}

export interface SessionForkTarget {
  checkpointId?: string | null;
  assistantMessageId: string;
  turnCount: number;
  responseGroupId?: string | null;
  canFork: boolean;
  disabledReason?: string | null;
}

export interface SessionRewriteTarget {
  checkpointId: string;
  userMessageId: string;
  turnCount: number;
}
