ALTER TABLE "agent_sessions" ALTER COLUMN "tool_ask_list" SET DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","copy_path","move_path","delete_file","delete_path","run_shell_command","make_http_request","web_search","web_fetch","create_routine","edit_routine","delete_routine","search_routine_by_oclock","list_routine_by_week","list_routine_by_date","ask_for_confirmation"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_sessions" ALTER COLUMN "enabled_capability_packs" SET DEFAULT '["workspace","schedule","web","lsp"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_settings" ALTER COLUMN "tool_ask_list" SET DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","copy_path","move_path","delete_file","delete_path","run_shell_command","make_http_request","web_search","web_fetch","create_routine","edit_routine","delete_routine","search_routine_by_oclock","list_routine_by_week","list_routine_by_date","ask_for_confirmation"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_settings" ALTER COLUMN "enabled_capability_packs" SET DEFAULT '["workspace","schedule","web","lsp"]'::jsonb;--> statement-breakpoint
UPDATE "agent_settings"
SET "enabled_capability_packs" = '["workspace","schedule","web","lsp"]'::jsonb
WHERE "enabled_capability_packs" IN (
  '["workspace","schedule"]'::jsonb,
  '["workspace","schedule","web"]'::jsonb
);
