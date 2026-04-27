ALTER TABLE "background_tasks"
  ADD COLUMN "available_at" timestamp with time zone;

CREATE INDEX "background_tasks_status_available_at_idx"
  ON "background_tasks" ("status", "available_at", "created_at");
