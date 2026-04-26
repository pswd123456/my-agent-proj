import { fileURLToPath } from "node:url";

import type {
  PendingConfirmationPayload,
  PendingPermissionRequest,
  SessionTodoState
} from "@ai-app-template/domain";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

import type { ProductDatabaseClient } from "./client.js";

const defaultToolAskListJson = JSON.stringify([
  "read_file",
  "list_directory",
  "search_text",
  "create_directory",
  "write_file",
  "edit_file",
  "copy_path",
  "move_path",
  "delete_path",
  "run_shell_command",
  "make_http_request",
  "create_routine",
  "edit_routine",
  "delete_routine",
  "search_routine_by_oclock",
  "list_routine_by_week",
  "list_routine_by_date",
  "ask_for_confirmation"
]);

function toSqlJsonbLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'::jsonb`;
}

const defaultToolAskListJsonLiteral = toSqlJsonbLiteral(defaultToolAskListJson);
const defaultCapabilityPacksJsonLiteral = toSqlJsonbLiteral(
  JSON.stringify(["workspace", "schedule"])
);
const defaultJsonbArray = sql.raw("'[]'::jsonb");

export const routines = pgTable(
  "routines",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    date: text("date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    startAt: timestamp("start_at", { mode: "string" }).notNull(),
    endAt: timestamp("end_at", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true
    })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    userStartAtIdx: index("routines_user_start_at_idx").on(
      table.userId,
      table.startAt
    )
  })
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    currentDateContext: text("current_date_context").notNull(),
    yoloMode: boolean("yolo_mode").notNull().default(false),
    workspaceEscapeAllowed: boolean("workspace_escape_allowed")
      .notNull()
      .default(false),
    contextWindow: integer("context_window").notNull().default(200000),
    maxTurns: integer("max_turns").notNull().default(50),
    shellAllowPatterns: jsonb("shell_allow_patterns")
      .$type<string[]>()
      .notNull()
      .default(defaultJsonbArray),
    shellDenyPatterns: jsonb("shell_deny_patterns")
      .$type<string[]>()
      .notNull()
      .default(defaultJsonbArray),
    toolAllowList: jsonb("tool_allow_list")
      .$type<string[]>()
      .notNull()
      .default(defaultJsonbArray),
    toolAskList: jsonb("tool_ask_list")
      .$type<string[]>()
      .notNull()
      .default(sql.raw(defaultToolAskListJsonLiteral)),
    toolDenyList: jsonb("tool_deny_list")
      .$type<string[]>()
      .notNull()
      .default(defaultJsonbArray),
    enabledCapabilityPacks: jsonb("enabled_capability_packs")
      .$type<string[]>()
      .notNull()
      .default(sql.raw(defaultCapabilityPacksJsonLiteral)),
    pendingPermissionRequest: jsonb(
      "pending_permission_request"
    ).$type<PendingPermissionRequest | null>(),
    pendingConfirmationPayload: jsonb(
      "pending_confirmation_payload"
    ).$type<PendingConfirmationPayload | null>(),
    todoState: jsonb("todo_state").$type<SessionTodoState | null>(),
    pendingConflictSummary: text("pending_conflict_summary"),
    lastUserMessage: text("last_user_message"),
    workingDirectory: text("working_directory").notNull(),
    model: text("model").notNull(),
    loopState: text("loop_state").notNull(),
    turnCount: integer("turn_count").notNull().default(0),
    lastError: text("last_error"),
    pendingToolCallIds: jsonb("pending_tool_call_ids")
      .$type<string[]>()
      .notNull()
      .default(defaultJsonbArray),
    interruptRequested: boolean("interrupt_requested").notNull().default(false),
    inputTokensCount: integer("input_tokens_count").notNull().default(0),
    promptCacheKey: text("prompt_cache_key").notNull().default(""),
    activeRunId: text("active_run_id"),
    activeRunStartedAt: timestamp("active_run_started_at", {
      mode: "string",
      withTimezone: true
    }),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true
    })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    updatedAtIdx: index("agent_sessions_updated_at_idx").on(table.updatedAt)
  })
);

export const agentSettings = pgTable("agent_settings", {
  userId: text("user_id").primaryKey(),
  workingDirectory: text("working_directory")
    .notNull()
    .default("agent-workspace"),
  yoloMode: boolean("yolo_mode").notNull().default(false),
  contextWindow: integer("context_window").notNull().default(200000),
  maxTurns: integer("max_turns").notNull().default(50),
  shellAllowPatterns: jsonb("shell_allow_patterns")
    .$type<string[]>()
    .notNull()
    .default(defaultJsonbArray),
  shellDenyPatterns: jsonb("shell_deny_patterns")
    .$type<string[]>()
    .notNull()
    .default(defaultJsonbArray),
  toolAllowList: jsonb("tool_allow_list")
    .$type<string[]>()
    .notNull()
    .default(defaultJsonbArray),
  toolAskList: jsonb("tool_ask_list")
    .$type<string[]>()
    .notNull()
    .default(sql.raw(defaultToolAskListJsonLiteral)),
  toolDenyList: jsonb("tool_deny_list")
    .$type<string[]>()
    .notNull()
    .default(defaultJsonbArray),
  enabledCapabilityPacks: jsonb("enabled_capability_packs")
    .$type<string[]>()
    .notNull()
    .default(sql.raw(defaultCapabilityPacksJsonLiteral)),
  debugConversationView: boolean("debug_conversation_view")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", {
    mode: "string",
    withTimezone: true
  })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", {
    mode: "string",
    withTimezone: true
  })
    .notNull()
    .defaultNow()
});

export const sessionMessages = pgTable(
  "session_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    messageIndex: integer("message_index").notNull(),
    role: text("role").notNull(),
    content: text("content"),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    state: text("state"),
    isError: boolean("is_error"),
    inputJson: jsonb("input_json").$type<Record<string, unknown> | null>(),
    outputText: text("output_text"),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true
    }).notNull()
  },
  (table) => ({
    sessionIndexIdx: index("session_messages_session_idx").on(
      table.sessionId,
      table.messageIndex
    ),
    sessionMessageUnique: uniqueIndex(
      "session_messages_session_id_message_index_key"
    ).on(table.sessionId, table.messageIndex)
  })
);

export const productSchema = {
  routines,
  agentSessions,
  agentSettings,
  sessionMessages
} as const;

export type ProductSchema = typeof productSchema;

export function isTimestampWithoutTimeZoneColumn(column: {
  data_type: string;
  udt_name: string;
}): boolean {
  return (
    column.data_type === "timestamp without time zone" ||
    column.udt_name === "timestamp"
  );
}

export async function ensureProductSchema(
  db: ProductDatabaseClient
): Promise<void> {
  const migrationsFolder = fileURLToPath(
    new URL("../migrations", import.meta.url)
  );
  await migrate(db, { migrationsFolder });
}
