CREATE TABLE "cron_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"working_directory" text NOT NULL,
	"schedule_mode" text NOT NULL,
	"interval_unit" text,
	"interval_value" integer,
	"weekday" text,
	"time_of_day" text,
	"starts_at" timestamp with time zone NOT NULL,
	"next_run_at" timestamp with time zone,
	"max_runs" integer,
	"run_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"model_override" text,
	"thinking_effort_override" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "cron_job_id" text;--> statement-breakpoint
CREATE INDEX "cron_jobs_user_created_at_idx" ON "cron_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "cron_jobs_status_next_run_at_idx" ON "cron_jobs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "agent_sessions_cron_job_updated_at_idx" ON "agent_sessions" USING btree ("cron_job_id","updated_at");