ALTER TABLE "agent_sessions" ALTER COLUMN "enabled_capability_packs" SET DEFAULT '["workspace","schedule","web"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_settings" ALTER COLUMN "enabled_capability_packs" SET DEFAULT '["workspace","schedule","web"]'::jsonb;--> statement-breakpoint
UPDATE "agent_settings"
SET "enabled_capability_packs" = '["workspace","schedule","web"]'::jsonb
WHERE "enabled_capability_packs" = '["workspace","schedule"]'::jsonb;
