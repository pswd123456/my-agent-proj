ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "enabled_capability_packs" jsonb DEFAULT '["workspace","schedule"]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN IF NOT EXISTS "enabled_capability_packs" jsonb DEFAULT '["workspace","schedule"]'::jsonb NOT NULL;
