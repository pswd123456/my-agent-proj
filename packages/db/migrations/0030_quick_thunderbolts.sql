ALTER TABLE "agent_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "agent_settings" CASCADE;--> statement-breakpoint
DROP INDEX "cron_jobs_user_created_at_idx";--> statement-breakpoint
DROP INDEX "inbox_bindings_user_updated_at_idx";--> statement-breakpoint
DROP INDEX "routines_user_start_at_idx";--> statement-breakpoint
CREATE INDEX "cron_jobs_created_at_idx" ON "cron_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inbox_bindings_updated_at_idx" ON "inbox_bindings" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "routines_start_at_idx" ON "routines" USING btree ("start_at");--> statement-breakpoint
ALTER TABLE "agent_sessions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "cron_jobs" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "inbox_bindings" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "routines" DROP COLUMN "user_id";