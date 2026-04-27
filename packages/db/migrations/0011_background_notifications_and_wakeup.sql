ALTER TABLE "agent_sessions"
  ADD COLUMN "active_background_task_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "pending_background_notifications" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "background_tasks"
  ADD COLUMN "deadline_at" timestamp with time zone,
  ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" integer NOT NULL DEFAULT 1;
