import type { ProductDatabaseClient } from "./client.js";

interface ColumnMetadataRow {
  data_type: string;
  udt_name: string;
}

function toIdentifier(value: string): string {
  if (!/^[a-z_]+$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }

  return value;
}

async function getColumnMetadata(
  sql: ProductDatabaseClient,
  tableName: string,
  columnName: string
): Promise<ColumnMetadataRow | null> {
  const rows = await sql<ColumnMetadataRow[]>`
    select data_type, udt_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `;

  return rows[0] ?? null;
}

export function isTimestampWithoutTimeZoneColumn(
  column: Pick<ColumnMetadataRow, "data_type" | "udt_name">
): boolean {
  return (
    column.data_type === "timestamp without time zone" ||
    column.udt_name === "timestamp"
  );
}

async function promoteColumnToTimestamptz(
  sql: ProductDatabaseClient,
  tableName: string,
  columnName: string
): Promise<void> {
  const column = await getColumnMetadata(sql, tableName, columnName);
  if (!column || !isTimestampWithoutTimeZoneColumn(column)) {
    return;
  }

  const safeTableName = toIdentifier(tableName);
  const safeColumnName = toIdentifier(columnName);

  await sql.unsafe(`
    alter table ${safeTableName}
    alter column ${safeColumnName} type timestamptz
    using ${safeColumnName} at time zone 'UTC'
  `);
}

export async function ensureProductSchema(
  sql: ProductDatabaseClient
): Promise<void> {
  await sql`
    create table if not exists routines (
      id text primary key,
      user_id text not null,
      name text not null,
      description text,
      date text not null,
      start_time text not null,
      end_time text not null,
      duration_minutes integer not null,
      start_at timestamp not null,
      end_at timestamp not null,
      status text not null,
      source text not null,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    )
  `;

  await sql`
    create index if not exists routines_user_start_at_idx
    on routines (user_id, start_at)
  `;

  await sql`
    create table if not exists agent_sessions (
      id text primary key,
      user_id text not null,
      status text not null,
      current_date_context text not null,
      yolo_mode boolean not null default false,
      context_window integer not null default 200000,
      max_turns integer not null default 50,
      pending_permission_request jsonb,
      pending_confirmation_payload jsonb,
      pending_conflict_summary text,
      last_user_message text,
      working_directory text not null,
      model text not null,
      loop_state text not null,
      turn_count integer not null default 0,
      last_error text,
      pending_tool_call_ids jsonb not null default '[]'::jsonb,
      input_tokens_count integer not null default 0,
      prompt_cache_key text not null default '',
      active_run_id text,
      active_run_started_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await sql`
    alter table agent_sessions
    add column if not exists yolo_mode boolean not null default false
  `;

  await sql`
    alter table agent_sessions
    add column if not exists context_window integer not null default 200000
  `;

  await sql`
    alter table agent_sessions
    add column if not exists max_turns integer not null default 50
  `;

  await sql`
    alter table agent_sessions
    add column if not exists pending_permission_request jsonb
  `;

  await sql`
    alter table agent_sessions
    add column if not exists active_run_id text
  `;

  await sql`
    alter table agent_sessions
    add column if not exists active_run_started_at timestamptz
  `;

  await promoteColumnToTimestamptz(
    sql,
    "agent_sessions",
    "active_run_started_at"
  );
  await promoteColumnToTimestamptz(sql, "agent_sessions", "created_at");
  await promoteColumnToTimestamptz(sql, "agent_sessions", "updated_at");

  await sql`
    create index if not exists agent_sessions_updated_at_idx
    on agent_sessions (updated_at)
  `;

  await sql`
    create table if not exists agent_settings (
      user_id text primary key,
      working_directory text not null,
      yolo_mode boolean not null default false,
      context_window integer not null default 200000,
      max_turns integer not null default 50,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await sql`
    alter table agent_settings
    add column if not exists working_directory text not null default 'agent-workspace'
  `;

  await sql`
    alter table agent_settings
    add column if not exists yolo_mode boolean not null default false
  `;

  await sql`
    alter table agent_settings
    add column if not exists context_window integer not null default 200000
  `;

  await sql`
    alter table agent_settings
    add column if not exists max_turns integer not null default 50
  `;

  await promoteColumnToTimestamptz(sql, "agent_settings", "created_at");
  await promoteColumnToTimestamptz(sql, "agent_settings", "updated_at");

  await sql`
    create table if not exists session_messages (
      id text primary key,
      session_id text not null references agent_sessions(id) on delete cascade,
      message_index integer not null,
      role text not null,
      content text,
      tool_name text,
      tool_call_id text,
      state text,
      is_error boolean,
      input_json jsonb,
      output_text text,
      created_at timestamptz not null,
      unique(session_id, message_index)
    )
  `;

  await promoteColumnToTimestamptz(sql, "session_messages", "created_at");

  await sql`
    update agent_sessions as sessions
    set updated_at = coalesce(
      (
        select max(messages.created_at)
        from session_messages as messages
        where messages.session_id = sessions.id
      ),
      sessions.updated_at
    )
  `;

  await sql`
    update agent_settings
    set updated_at = coalesce(updated_at, now())
  `;

  await sql`
    create index if not exists session_messages_session_idx
    on session_messages (session_id, message_index)
  `;
}
