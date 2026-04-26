ALTER TABLE "agent_sessions"
  ADD COLUMN "full_compaction_state" jsonb;

ALTER TABLE "agent_sessions"
  ADD COLUMN "history_compactions_since_full_compaction" integer NOT NULL DEFAULT 0;
