import { randomUUID } from "node:crypto";

import type { ProductDatabaseClient } from "@ai-app-template/db";
import type { ScheduleSessionContext } from "@ai-app-template/domain";

import type {
  ConversationBlock,
  CreateSessionInput,
  JsonValue,
  LoopState,
  SessionSnapshot
} from "../types.js";
import type { SessionManager } from "./contracts.js";
import {
  cloneSnapshot,
  createSnapshot,
  isSessionSnapshot,
  resolveWorkingDirectory
} from "./shared.js";

interface SessionRow {
  id: string;
  user_id: string;
  status: string;
  current_date_context: string;
  pending_confirmation_payload: unknown;
  pending_conflict_summary: string | null;
  last_user_message: string | null;
  working_directory: string;
  model: string;
  loop_state: string;
  turn_count: number;
  last_error: string | null;
  pending_tool_call_ids: unknown;
  input_tokens_count: number;
  prompt_cache_key: string;
  updated_at: string | Date;
}

interface SessionMessageRow {
  id: string;
  message_index: number;
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_call_id: string | null;
  state: string | null;
  is_error: boolean | null;
  input_json: unknown;
  output_text: string | null;
  created_at: string | Date;
}

function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toConversationBlock(row: SessionMessageRow): ConversationBlock {
  const createdAt = toIsoString(row.created_at);
  if (row.role === "user") {
    return {
      id: row.id,
      kind: "user",
      content: row.content ?? "",
      createdAt
    };
  }

  if (row.role === "assistant") {
    return {
      id: row.id,
      kind: "assistant",
      content: row.content ?? "",
      createdAt
    };
  }

  if (row.role === "tool_call") {
    return {
      id: row.id,
      kind: "tool call",
      toolCallId: row.tool_call_id ?? "",
      toolName: row.tool_name ?? "",
      input: isRecord(row.input_json)
        ? (row.input_json as Record<string, JsonValue>)
        : {},
      state: row.state === "success" || row.state === "failed" ? row.state : "pending",
      createdAt
    } as ConversationBlock;
  }

  return {
    id: row.id,
    kind: "tool result",
    toolCallId: row.tool_call_id ?? "",
    toolName: row.tool_name ?? "",
    output: row.output_text ?? "",
    isError: Boolean(row.is_error),
    state: row.state === "pending" || row.state === "success" ? row.state : "failed",
    createdAt
  };
}

function toSessionContext(row: SessionRow): ScheduleSessionContext {
    return {
      userId: row.user_id,
      status: row.status as ScheduleSessionContext["status"],
      currentDateContext: row.current_date_context,
      pendingConfirmationPayload: isRecord(row.pending_confirmation_payload)
      ? (row.pending_confirmation_payload as unknown as ScheduleSessionContext["pendingConfirmationPayload"])
      : null,
    pendingConflictSummary: row.pending_conflict_summary,
    lastUserMessage: row.last_user_message
  };
}

function serializeBlock(block: ConversationBlock): {
  role: string;
  content: string | null;
  toolName: string | null;
  toolCallId: string | null;
  state: string | null;
  isError: boolean | null;
  inputJson: string | null;
  outputText: string | null;
  createdAt: string;
} {
  if (block.kind === "user") {
    return {
      role: "user",
      content: block.content,
      toolName: null,
      toolCallId: null,
      state: null,
      isError: null,
      inputJson: null,
      outputText: null,
      createdAt: block.createdAt
    };
  }

  if (block.kind === "assistant") {
    return {
      role: "assistant",
      content: block.content,
      toolName: null,
      toolCallId: null,
      state: null,
      isError: null,
      inputJson: null,
      outputText: null,
      createdAt: block.createdAt
    };
  }

  if (block.kind === "tool call") {
    return {
      role: "tool_call",
      content: null,
      toolName: block.toolName,
      toolCallId: block.toolCallId,
      state: block.state,
      isError: null,
      inputJson: JSON.stringify(block.input),
      outputText: null,
      createdAt: block.createdAt
    };
  }

  return {
    role: "tool_result",
    content: null,
    toolName: block.toolName,
    toolCallId: block.toolCallId,
    state: block.state,
    isError: block.isError,
    inputJson: null,
    outputText: block.output,
    createdAt: block.createdAt
  };
}

export class PostgresSessionManager implements SessionManager {
  constructor(private readonly sql: ProductDatabaseClient) {}

  async createSession(input: CreateSessionInput = {}): Promise<SessionSnapshot> {
    const createSnapshotInput: {
      sessionId: string;
      workingDirectory: string;
      model: string;
      userId?: string;
    } = {
      sessionId: randomUUID(),
      workingDirectory: resolveWorkingDirectory(input.workingDirectory),
      model: input.model ?? "MiniMax-M2.7"
    };

    if (typeof input.userId === "string" && input.userId.length > 0) {
      createSnapshotInput.userId = input.userId;
    }

    const snapshot = createSnapshot(createSnapshotInput);

    await this.persistSession(snapshot);
    return cloneSnapshot(snapshot);
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    const sessionRows = await this.sql<SessionRow[]>`
      select *
      from agent_sessions
      where id = ${sessionId}
      limit 1
    `;

    const row = sessionRows[0];
    if (!row) {
      return null;
    }

    const messageRows = await this.sql<SessionMessageRow[]>`
      select *
      from session_messages
      where session_id = ${sessionId}
      order by message_index asc
    `;

    return {
      sessionId: row.id,
      workingDirectory: row.working_directory,
      model: row.model,
      context: toSessionContext(row),
      messages: messageRows.map(toConversationBlock),
      sessionState: {
        loopState: row.loop_state as LoopState,
        turnCount: row.turn_count,
        lastError: row.last_error,
        pendingToolCallIds: Array.isArray(row.pending_tool_call_ids)
          ? row.pending_tool_call_ids.filter(
              (value): value is string => typeof value === "string"
            )
          : []
      },
      inputTokensCount: row.input_tokens_count,
      promptCacheKey: row.prompt_cache_key,
      updatedAt: toIsoString(row.updated_at)
    };
  }

  async listSessions(): Promise<SessionSnapshot[]> {
    const rows = await this.sql<SessionRow[]>`
      select *
      from agent_sessions
      order by updated_at asc
    `;

    const sessions = await Promise.all(rows.map((row) => this.getSession(row.id)));
    return sessions.flatMap((session) => (session ? [session] : []));
  }

  async saveSession(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    if (!isSessionSnapshot(snapshot)) {
      throw new Error("Invalid session snapshot.");
    }

    const nextSnapshot = cloneSnapshot(snapshot);
    nextSnapshot.updatedAt = new Date().toISOString();
    await this.persistSession(nextSnapshot);
    return cloneSnapshot(nextSnapshot);
  }

  async recover(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    if (!isSessionSnapshot(snapshot)) {
      throw new Error("Invalid session snapshot.");
    }

    const nextSnapshot = cloneSnapshot(snapshot);
    nextSnapshot.updatedAt = new Date().toISOString();
    await this.persistSession(nextSnapshot);
    await this.sql`delete from session_messages where session_id = ${snapshot.sessionId}`;
    for (const [index, block] of nextSnapshot.messages.entries()) {
      await this.insertMessage(snapshot.sessionId, index, block);
    }

    return cloneSnapshot(nextSnapshot);
  }

  async appendBlock(
    sessionId: string,
    block: ConversationBlock
  ): Promise<SessionSnapshot> {
    const nextIndexRows = await this.sql<Array<{ next_index: number }>>`
      select coalesce(max(message_index), -1) + 1 as next_index
      from session_messages
      where session_id = ${sessionId}
    `;
    const nextIndex = nextIndexRows[0]?.next_index ?? 0;
    await this.insertMessage(sessionId, nextIndex, block);
    await this.sql`
      update agent_sessions
      set updated_at = now()
      where id = ${sessionId}
    `;
    const snapshot = await this.getSession(sessionId);
    if (!snapshot) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return snapshot;
  }

  async setLoopState(
    sessionId: string,
    loopState: LoopState
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        loopState
      }
    }));
  }

  async setPromptCacheKey(
    sessionId: string,
    promptCacheKey: string
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      promptCacheKey
    }));
  }

  async setTurnCount(
    sessionId: string,
    turnCount: number
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        turnCount: Math.max(0, Math.floor(turnCount))
      }
    }));
  }

  async setPendingToolCallIds(
    sessionId: string,
    pendingToolCallIds: string[]
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        pendingToolCallIds: [...pendingToolCallIds]
      }
    }));
  }

  async addInputTokens(
    sessionId: string,
    inputTokens: number
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      inputTokensCount: snapshot.inputTokensCount + Math.max(0, inputTokens)
    }));
  }

  async setLastError(
    sessionId: string,
    lastError: string | null
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        lastError
      }
    }));
  }

  async updateContext(
    sessionId: string,
    patch: Partial<ScheduleSessionContext>
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      context: {
        ...snapshot.context,
        ...structuredClone(patch)
      }
    }));
  }

  private async updateSession(
    sessionId: string,
    updater: (snapshot: SessionSnapshot) => SessionSnapshot
  ): Promise<SessionSnapshot> {
    const snapshot = await this.getSession(sessionId);
    if (!snapshot) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const nextSnapshot = cloneSnapshot(updater(snapshot));
    nextSnapshot.updatedAt = new Date().toISOString();
    await this.persistSession(nextSnapshot);
    return cloneSnapshot(nextSnapshot);
  }

  private async persistSession(snapshot: SessionSnapshot): Promise<void> {
    await this.sql`
      insert into agent_sessions (
        id,
        user_id,
        status,
        current_date_context,
        pending_confirmation_payload,
        pending_conflict_summary,
        last_user_message,
        working_directory,
        model,
        loop_state,
        turn_count,
        last_error,
        pending_tool_call_ids,
        input_tokens_count,
        prompt_cache_key,
        created_at,
        updated_at
      )
      values (
        ${snapshot.sessionId},
        ${snapshot.context.userId},
        ${snapshot.context.status},
        ${snapshot.context.currentDateContext},
        ${
          snapshot.context.pendingConfirmationPayload
            ? JSON.stringify(snapshot.context.pendingConfirmationPayload)
            : null
        }::jsonb,
        ${snapshot.context.pendingConflictSummary},
        ${snapshot.context.lastUserMessage},
        ${snapshot.workingDirectory},
        ${snapshot.model},
        ${snapshot.sessionState.loopState},
        ${snapshot.sessionState.turnCount},
        ${snapshot.sessionState.lastError},
        ${JSON.stringify(snapshot.sessionState.pendingToolCallIds)}::jsonb,
        ${snapshot.inputTokensCount},
        ${snapshot.promptCacheKey},
        ${snapshot.updatedAt},
        ${snapshot.updatedAt}
      )
      on conflict (id) do update set
        user_id = excluded.user_id,
        status = excluded.status,
        current_date_context = excluded.current_date_context,
        pending_confirmation_payload = excluded.pending_confirmation_payload,
        pending_conflict_summary = excluded.pending_conflict_summary,
        last_user_message = excluded.last_user_message,
        working_directory = excluded.working_directory,
        model = excluded.model,
        loop_state = excluded.loop_state,
        turn_count = excluded.turn_count,
        last_error = excluded.last_error,
        pending_tool_call_ids = excluded.pending_tool_call_ids,
        input_tokens_count = excluded.input_tokens_count,
        prompt_cache_key = excluded.prompt_cache_key,
        updated_at = excluded.updated_at
    `;
  }

  private async insertMessage(
    sessionId: string,
    index: number,
    block: ConversationBlock
  ): Promise<void> {
    const serialized = serializeBlock(block);
    await this.sql`
      insert into session_messages (
        id,
        session_id,
        message_index,
        role,
        content,
        tool_name,
        tool_call_id,
        state,
        is_error,
        input_json,
        output_text,
        created_at
      )
      values (
        ${block.id},
        ${sessionId},
        ${index},
        ${serialized.role},
        ${serialized.content},
        ${serialized.toolName},
        ${serialized.toolCallId},
        ${serialized.state},
        ${serialized.isError},
        ${serialized.inputJson}::jsonb,
        ${serialized.outputText},
        ${serialized.createdAt}
      )
    `;
  }
}

export function createPostgresSessionManager(
  sql: ProductDatabaseClient
): PostgresSessionManager {
  return new PostgresSessionManager(sql);
}
