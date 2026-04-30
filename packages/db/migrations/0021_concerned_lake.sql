ALTER TABLE "agent_sessions" ALTER COLUMN "tool_ask_list" SET DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","copy_path","move_path","delete_file","delete_path","run_shell_command","make_http_request","create_routine","edit_routine","delete_routine","search_routine_by_oclock","list_routine_by_week","list_routine_by_date","ask_for_confirmation"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_sessions" ALTER COLUMN "enabled_capability_packs" SET DEFAULT '["workspace","schedule","lsp"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_settings" ALTER COLUMN "tool_ask_list" SET DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","copy_path","move_path","delete_file","delete_path","run_shell_command","make_http_request","create_routine","edit_routine","delete_routine","search_routine_by_oclock","list_routine_by_week","list_routine_by_date","ask_for_confirmation"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_settings" ALTER COLUMN "enabled_capability_packs" SET DEFAULT '["workspace","schedule","lsp"]'::jsonb;
--> statement-breakpoint
UPDATE "agent_sessions"
SET "enabled_capability_packs" = COALESCE(
  (
    SELECT jsonb_agg(item.value ORDER BY item.ordinality)
    FROM jsonb_array_elements_text("agent_sessions"."enabled_capability_packs") WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> 'web'
  ),
  '[]'::jsonb
)
WHERE "enabled_capability_packs" ? 'web';
--> statement-breakpoint
UPDATE "agent_settings"
SET "enabled_capability_packs" = COALESCE(
  (
    SELECT jsonb_agg(item.value ORDER BY item.ordinality)
    FROM jsonb_array_elements_text("agent_settings"."enabled_capability_packs") WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> 'web'
  ),
  '[]'::jsonb
)
WHERE "enabled_capability_packs" ? 'web';
--> statement-breakpoint
UPDATE "agent_sessions"
SET
  "tool_allow_list" = COALESCE(
    (
      SELECT jsonb_agg(item.value ORDER BY item.ordinality)
      FROM jsonb_array_elements_text("agent_sessions"."tool_allow_list") WITH ORDINALITY AS item(value, ordinality)
      WHERE item.value NOT IN ('web_search', 'web_fetch')
    ),
    '[]'::jsonb
  ),
  "tool_ask_list" = COALESCE(
    (
      SELECT jsonb_agg(item.value ORDER BY item.ordinality)
      FROM jsonb_array_elements_text("agent_sessions"."tool_ask_list") WITH ORDINALITY AS item(value, ordinality)
      WHERE item.value NOT IN ('web_search', 'web_fetch')
    ),
    '[]'::jsonb
  ),
  "tool_deny_list" = COALESCE(
    (
      SELECT jsonb_agg(item.value ORDER BY item.ordinality)
      FROM jsonb_array_elements_text("agent_sessions"."tool_deny_list") WITH ORDINALITY AS item(value, ordinality)
      WHERE item.value NOT IN ('web_search', 'web_fetch')
    ),
    '[]'::jsonb
  )
WHERE
  "tool_allow_list" ?| ARRAY['web_search', 'web_fetch']
  OR "tool_ask_list" ?| ARRAY['web_search', 'web_fetch']
  OR "tool_deny_list" ?| ARRAY['web_search', 'web_fetch'];
--> statement-breakpoint
UPDATE "agent_settings"
SET
  "tool_allow_list" = COALESCE(
    (
      SELECT jsonb_agg(item.value ORDER BY item.ordinality)
      FROM jsonb_array_elements_text("agent_settings"."tool_allow_list") WITH ORDINALITY AS item(value, ordinality)
      WHERE item.value NOT IN ('web_search', 'web_fetch')
    ),
    '[]'::jsonb
  ),
  "tool_ask_list" = COALESCE(
    (
      SELECT jsonb_agg(item.value ORDER BY item.ordinality)
      FROM jsonb_array_elements_text("agent_settings"."tool_ask_list") WITH ORDINALITY AS item(value, ordinality)
      WHERE item.value NOT IN ('web_search', 'web_fetch')
    ),
    '[]'::jsonb
  ),
  "tool_deny_list" = COALESCE(
    (
      SELECT jsonb_agg(item.value ORDER BY item.ordinality)
      FROM jsonb_array_elements_text("agent_settings"."tool_deny_list") WITH ORDINALITY AS item(value, ordinality)
      WHERE item.value NOT IN ('web_search', 'web_fetch')
    ),
    '[]'::jsonb
  )
WHERE
  "tool_allow_list" ?| ARRAY['web_search', 'web_fetch']
  OR "tool_ask_list" ?| ARRAY['web_search', 'web_fetch']
  OR "tool_deny_list" ?| ARRAY['web_search', 'web_fetch'];
