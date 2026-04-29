ALTER TABLE "agent_sessions" ADD COLUMN "thinking_effort" text DEFAULT 'high' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "thinking_effort" text DEFAULT 'high' NOT NULL;