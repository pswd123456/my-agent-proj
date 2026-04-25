ALTER TABLE "agent_settings" ADD COLUMN IF NOT EXISTS "debug_conversation_view" boolean DEFAULT false NOT NULL;
