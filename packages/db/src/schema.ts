import { fileURLToPath } from "node:url";

import type {
  BackgroundTaskPayload,
  BackgroundTaskState,
  PendingConfirmationPayload,
  BackgroundTaskStatus,
  BackgroundTaskKind,
  PendingPermissionRequest,
  SessionBackgroundNotification,
  SessionFullCompactionState,
  PendingUserQuestionPayload,
  SessionTodoState,
  HookContextEntry,
  UserContextHookRecord
} from "@ai-app-template/domain";
import {
  DEFAULT_SESSION_MODEL,
  DEFAULT_SESSION_MAX_TURNS,
  DEFAULT_THINKING_EFFORT,
  type ThinkingEffort
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
  "copy_path",
  "move_path",
  "delete_file",
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
  JSON.stringify(["workspace", "schedule", "lsp"])
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
    planModeEnabled: boolean("plan_mode_enabled").notNull().default(false),
    thinkingEffort: text("thinking_effort")
      .$type<ThinkingEffort>()
      .notNull()
      .default(DEFAULT_THINKING_EFFORT),
    taskBriefPath: text("task_brief_path"),
    workspaceEscapeAllowed: boolean("workspace_escape_allowed")
      .notNull()
      .default(false),
    contextWindow: integer("context_window").notNull().default(200000),
    maxTurns: integer("max_turns").notNull().default(DEFAULT_SESSION_MAX_TURNS),
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
    activeBackgroundTaskCount: integer("active_background_task_count")
      .notNull()
      .default(0),
    pendingPermissionRequest: jsonb(
      "pending_permission_request"
    ).$type<PendingPermissionRequest | null>(),
    pendingConfirmationPayload: jsonb(
      "pending_confirmation_payload"
    ).$type<PendingConfirmationPayload | null>(),
    pendingUserQuestionPayload: jsonb(
      "pending_user_question_payload"
    ).$type<PendingUserQuestionPayload | null>(),
    pendingBackgroundNotifications: jsonb("pending_background_notifications")
      .$type<SessionBackgroundNotification[]>()
      .notNull()
      .default(defaultJsonbArray),
    hookContextEntries: jsonb("hook_context_entries")
      .$type<HookContextEntry[]>()
      .notNull()
      .default(defaultJsonbArray),
    todoState: jsonb("todo_state").$type<SessionTodoState | null>(),
    fullCompactionState: jsonb(
      "full_compaction_state"
    ).$type<SessionFullCompactionState | null>(),
    pendingConflictSummary: text("pending_conflict_summary"),
    firstUserMessage: text("first_user_message"),
    lastUserMessage: text("last_user_message"),
    parentSessionId: text("parent_session_id"),
    parentRelationKind: text("parent_relation_kind"),
    forkReplayCheckpointId: text("fork_replay_checkpoint_id"),
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
    historyCompactionsSinceFullCompaction: integer(
      "history_compactions_since_full_compaction"
    )
      .notNull()
      .default(0),
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
  model: text("model").notNull().default(DEFAULT_SESSION_MODEL),
  thinkingEffort: text("thinking_effort")
    .$type<ThinkingEffort>()
    .notNull()
    .default(DEFAULT_THINKING_EFFORT),
  yoloMode: boolean("yolo_mode").notNull().default(false),
  contextWindow: integer("context_window").notNull().default(200000),
  maxTurns: integer("max_turns").notNull().default(DEFAULT_SESSION_MAX_TURNS),
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
  workspaceSkillSettings: jsonb("workspace_skill_settings")
    .$type<Array<{ skillName: string; enabled: boolean }>>()
    .notNull()
    .default(defaultJsonbArray),
  userContextHooks: jsonb("user_context_hooks")
    .$type<UserContextHookRecord[]>()
    .notNull()
    .default(defaultJsonbArray),
  debugConversationView: boolean("debug_conversation_view")
    .notNull()
    .default(false),
  userCustomPrompt: text("user_custom_prompt").notNull().default(""),
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

export const backgroundTasks = pgTable(
  "background_tasks",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<BackgroundTaskKind>().notNull(),
    status: text("status").$type<BackgroundTaskStatus>().notNull(),
    executor: text("executor").notNull(),
    parentSessionId: text("parent_session_id"),
    childSessionId: text("child_session_id"),
    payload: jsonb("payload").$type<BackgroundTaskPayload>().notNull(),
    taskState: jsonb("task_state").$type<BackgroundTaskState | null>(),
    resultSummary: text("result_summary"),
    lastError: text("last_error"),
    availableAt: timestamp("available_at", {
      mode: "string",
      withTimezone: true
    }),
    deadlineAt: timestamp("deadline_at", {
      mode: "string",
      withTimezone: true
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(1),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    activeRunId: text("active_run_id"),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", {
      mode: "string",
      withTimezone: true
    }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", {
      mode: "string",
      withTimezone: true
    }),
    completedAt: timestamp("completed_at", {
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
    statusUpdatedIdx: index("background_tasks_status_updated_at_idx").on(
      table.status,
      table.updatedAt
    ),
    statusAvailableIdx: index("background_tasks_status_available_at_idx").on(
      table.status,
      table.availableAt,
      table.createdAt
    ),
    childSessionUnique: uniqueIndex("background_tasks_child_session_id_key").on(
      table.childSessionId
    )
  })
);

export const backgroundTaskRuns = pgTable(
  "background_task_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    runId: text("run_id").notNull(),
    status: text("status").$type<BackgroundTaskStatus>().notNull(),
    workerId: text("worker_id"),
    errorSummary: text("error_summary"),
    resultSummary: text("result_summary"),
    startedAt: timestamp("started_at", {
      mode: "string",
      withTimezone: true
    })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      mode: "string",
      withTimezone: true
    }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", {
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
    taskStatusUpdatedIdx: index(
      "background_task_runs_task_status_updated_idx"
    ).on(table.taskId, table.status, table.updatedAt),
    runUnique: uniqueIndex("background_task_runs_run_id_key").on(table.runId)
  })
);

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

export const sessionForkCheckpoints = pgTable(
  "session_fork_checkpoints",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    assistantMessageId: text("assistant_message_id").notNull(),
    turnCount: integer("turn_count").notNull(),
    baseMessageCount: integer("base_message_count").notNull(),
    responseGroupId: text("response_group_id"),
    snapshotJson: jsonb("snapshot_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    promptSeedJson: jsonb("prompt_seed_json")
      .$type<Record<string, unknown>>()
      .notNull(),
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
    sessionCreatedIdx: index("session_fork_checkpoints_session_created_idx").on(
      table.sessionId,
      table.createdAt
    ),
    sessionAssistantUnique: uniqueIndex(
      "session_fork_checkpoints_session_assistant_message_key"
    ).on(table.sessionId, table.assistantMessageId)
  })
);

export const productSchema = {
  routines,
  agentSessions,
  agentSettings,
  backgroundTasks,
  backgroundTaskRuns,
  sessionMessages,
  sessionForkCheckpoints
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
