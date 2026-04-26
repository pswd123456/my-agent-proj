ALTER TABLE "agent_sessions" ADD COLUMN "plan_mode_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "task_brief_path" text;--> statement-breakpoint
