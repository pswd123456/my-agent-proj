import type { ProductDatabaseClient } from "./client.js";

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
      active_run_started_at timestamp,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    )
  `;

  await sql`
    alter table agent_sessions
    add column if not exists active_run_id text
  `;

  await sql`
    alter table agent_sessions
    add column if not exists active_run_started_at timestamp
  `;

  await sql`
    create index if not exists agent_sessions_updated_at_idx
    on agent_sessions (updated_at)
  `;

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
      created_at timestamp not null,
      unique(session_id, message_index)
    )
  `;

  await sql`
    create index if not exists session_messages_session_idx
    on session_messages (session_id, message_index)
  `;
}
