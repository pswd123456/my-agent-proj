CREATE TABLE IF NOT EXISTS "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"current_date_context" text NOT NULL,
	"yolo_mode" boolean DEFAULT false NOT NULL,
	"context_window" integer DEFAULT 200000 NOT NULL,
	"max_turns" integer DEFAULT 50 NOT NULL,
	"shell_allow_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shell_deny_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_allow_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_ask_list" jsonb DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","copy_path","move_path","delete_path","run_shell_command","make_http_request","create_routine","edit_routine","delete_routine","search_routine_by_oclock","list_routine_by_week","list_routine_by_date","ask_for_confirmation"]'::jsonb NOT NULL,
	"tool_deny_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_permission_request" jsonb,
	"pending_confirmation_payload" jsonb,
	"pending_conflict_summary" text,
	"last_user_message" text,
	"working_directory" text NOT NULL,
	"model" text NOT NULL,
	"loop_state" text NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"pending_tool_call_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interrupt_requested" boolean DEFAULT false NOT NULL,
	"input_tokens_count" integer DEFAULT 0 NOT NULL,
	"prompt_cache_key" text DEFAULT '' NOT NULL,
	"active_run_id" text,
	"active_run_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"working_directory" text DEFAULT 'agent-workspace' NOT NULL,
	"yolo_mode" boolean DEFAULT false NOT NULL,
	"context_window" integer DEFAULT 200000 NOT NULL,
	"max_turns" integer DEFAULT 50 NOT NULL,
	"shell_allow_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shell_deny_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_allow_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_ask_list" jsonb DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","copy_path","move_path","delete_path","run_shell_command","make_http_request","create_routine","edit_routine","delete_routine","search_routine_by_oclock","list_routine_by_week","list_routine_by_date","ask_for_confirmation"]'::jsonb NOT NULL,
	"tool_deny_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routines" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"message_index" integer NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_name" text,
	"tool_call_id" text,
	"state" text,
	"is_error" boolean,
	"input_json" jsonb,
	"output_text" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_updated_at_idx" ON "agent_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routines_user_start_at_idx" ON "routines" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_messages_session_idx" ON "session_messages" USING btree ("session_id","message_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_messages_session_id_message_index_key" ON "session_messages" USING btree ("session_id","message_index");
