CREATE TABLE "background_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "executor" text NOT NULL,
  "parent_session_id" text,
  "child_session_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "result_summary" text,
  "last_error" text,
  "cancel_requested" boolean NOT NULL DEFAULT false,
  "active_run_id" text,
  "claimed_by" text,
  "claimed_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "background_tasks_child_session_id_key"
  ON "background_tasks" ("child_session_id");

CREATE INDEX "background_tasks_status_updated_at_idx"
  ON "background_tasks" ("status", "updated_at");

CREATE TABLE "background_task_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "run_id" text NOT NULL,
  "status" text NOT NULL,
  "worker_id" text,
  "error_summary" text,
  "result_summary" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "background_task_runs_run_id_key"
  ON "background_task_runs" ("run_id");

CREATE INDEX "background_task_runs_task_status_updated_idx"
  ON "background_task_runs" ("task_id", "status", "updated_at");

