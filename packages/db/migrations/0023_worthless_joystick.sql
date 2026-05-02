CREATE TABLE "session_fork_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"assistant_message_id" text NOT NULL,
	"turn_count" integer NOT NULL,
	"base_message_count" integer NOT NULL,
	"response_group_id" text,
	"snapshot_json" jsonb NOT NULL,
	"prompt_seed_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "hook_context_entries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "parent_session_id" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "parent_relation_kind" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "fork_replay_checkpoint_id" text;--> statement-breakpoint
ALTER TABLE "session_fork_checkpoints" ADD CONSTRAINT "session_fork_checkpoints_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_fork_checkpoints_session_created_idx" ON "session_fork_checkpoints" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_fork_checkpoints_session_assistant_message_key" ON "session_fork_checkpoints" USING btree ("session_id","assistant_message_id");