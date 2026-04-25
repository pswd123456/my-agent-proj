ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "workspace_escape_allowed" boolean DEFAULT false NOT NULL;
