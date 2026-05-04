CREATE TABLE "inbox_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"active_session_id" text,
	"user_id" text NOT NULL,
	"settings" jsonb DEFAULT '{"responseOutputMode":"final"}'::jsonb NOT NULL,
	"last_update_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_bindings_channel_external_chat_id_key" ON "inbox_bindings" USING btree ("channel","external_chat_id");--> statement-breakpoint
CREATE INDEX "inbox_bindings_user_updated_at_idx" ON "inbox_bindings" USING btree ("user_id","updated_at");