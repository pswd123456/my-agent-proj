ALTER TABLE "agent_settings" ADD COLUMN IF NOT EXISTS "model" text DEFAULT 'MiniMax-M2.7' NOT NULL;
