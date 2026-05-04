ALTER TABLE "agent_sessions" ALTER COLUMN "tool_ask_list" SET DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","manage_path","delete_file","delete_path","run_shell_command","make_http_request","manage_routine","query_routines","ask_for_confirmation","manage_cron_jobs"]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_settings" ALTER COLUMN "tool_ask_list" SET DEFAULT '["read_file","list_directory","search_text","create_directory","write_file","manage_path","delete_file","delete_path","run_shell_command","make_http_request","manage_routine","query_routines","ask_for_confirmation","manage_cron_jobs"]'::jsonb;--> statement-breakpoint
UPDATE "agent_sessions"
SET "tool_ask_list" =
  "tool_ask_list"
  - 'create_routine'
  - 'edit_routine'
  - 'delete_routine'
  - 'search_routine_by_oclock'
  - 'list_routine_by_week'
  - 'list_routine_by_date'
  - 'get_todo_list'
  - 'replace_todo_list'
  - 'update_todo_items'
  - 'get_task_brief'
  - 'read_task_brief'
  - 'search_task_brief'
  - 'edit_task_brief'
  - 'replace_task_brief'
  || CASE WHEN "tool_ask_list" ?| array['create_routine','edit_routine','delete_routine'] AND NOT "tool_ask_list" ? 'manage_routine' THEN '["manage_routine"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_ask_list" ? 'query_routines' THEN '["query_routines"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['get_todo_list','replace_todo_list','update_todo_items'] AND NOT "tool_ask_list" ? 'manage_todo_list' THEN '["manage_todo_list"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'] AND NOT "tool_ask_list" ? 'manage_task_brief' THEN '["manage_task_brief"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_ask_list" ? 'manage_cron_jobs' THEN '["manage_cron_jobs"]'::jsonb ELSE '[]'::jsonb END
WHERE "tool_ask_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date','get_todo_list','replace_todo_list','update_todo_items','get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'];--> statement-breakpoint
UPDATE "agent_settings"
SET "tool_ask_list" =
  "tool_ask_list"
  - 'create_routine'
  - 'edit_routine'
  - 'delete_routine'
  - 'search_routine_by_oclock'
  - 'list_routine_by_week'
  - 'list_routine_by_date'
  - 'get_todo_list'
  - 'replace_todo_list'
  - 'update_todo_items'
  - 'get_task_brief'
  - 'read_task_brief'
  - 'search_task_brief'
  - 'edit_task_brief'
  - 'replace_task_brief'
  || CASE WHEN "tool_ask_list" ?| array['create_routine','edit_routine','delete_routine'] AND NOT "tool_ask_list" ? 'manage_routine' THEN '["manage_routine"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_ask_list" ? 'query_routines' THEN '["query_routines"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['get_todo_list','replace_todo_list','update_todo_items'] AND NOT "tool_ask_list" ? 'manage_todo_list' THEN '["manage_todo_list"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'] AND NOT "tool_ask_list" ? 'manage_task_brief' THEN '["manage_task_brief"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_ask_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_ask_list" ? 'manage_cron_jobs' THEN '["manage_cron_jobs"]'::jsonb ELSE '[]'::jsonb END
WHERE "tool_ask_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date','get_todo_list','replace_todo_list','update_todo_items','get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'];--> statement-breakpoint
UPDATE "agent_sessions"
SET "tool_allow_list" =
  "tool_allow_list"
  - 'create_routine'
  - 'edit_routine'
  - 'delete_routine'
  - 'search_routine_by_oclock'
  - 'list_routine_by_week'
  - 'list_routine_by_date'
  - 'get_todo_list'
  - 'replace_todo_list'
  - 'update_todo_items'
  - 'get_task_brief'
  - 'read_task_brief'
  - 'search_task_brief'
  - 'edit_task_brief'
  - 'replace_task_brief'
  || CASE WHEN "tool_allow_list" ?| array['create_routine','edit_routine','delete_routine'] AND NOT "tool_allow_list" ? 'manage_routine' THEN '["manage_routine"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_allow_list" ?| array['search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_allow_list" ? 'query_routines' THEN '["query_routines"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_allow_list" ?| array['get_todo_list','replace_todo_list','update_todo_items'] AND NOT "tool_allow_list" ? 'manage_todo_list' THEN '["manage_todo_list"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_allow_list" ?| array['get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'] AND NOT "tool_allow_list" ? 'manage_task_brief' THEN '["manage_task_brief"]'::jsonb ELSE '[]'::jsonb END
WHERE "tool_allow_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date','get_todo_list','replace_todo_list','update_todo_items','get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'];--> statement-breakpoint
UPDATE "agent_settings"
SET "tool_allow_list" =
  "tool_allow_list"
  - 'create_routine'
  - 'edit_routine'
  - 'delete_routine'
  - 'search_routine_by_oclock'
  - 'list_routine_by_week'
  - 'list_routine_by_date'
  - 'get_todo_list'
  - 'replace_todo_list'
  - 'update_todo_items'
  - 'get_task_brief'
  - 'read_task_brief'
  - 'search_task_brief'
  - 'edit_task_brief'
  - 'replace_task_brief'
  || CASE WHEN "tool_allow_list" ?| array['create_routine','edit_routine','delete_routine'] AND NOT "tool_allow_list" ? 'manage_routine' THEN '["manage_routine"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_allow_list" ?| array['search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_allow_list" ? 'query_routines' THEN '["query_routines"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_allow_list" ?| array['get_todo_list','replace_todo_list','update_todo_items'] AND NOT "tool_allow_list" ? 'manage_todo_list' THEN '["manage_todo_list"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_allow_list" ?| array['get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'] AND NOT "tool_allow_list" ? 'manage_task_brief' THEN '["manage_task_brief"]'::jsonb ELSE '[]'::jsonb END
WHERE "tool_allow_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date','get_todo_list','replace_todo_list','update_todo_items','get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'];--> statement-breakpoint
UPDATE "agent_sessions"
SET "tool_deny_list" =
  "tool_deny_list"
  - 'create_routine'
  - 'edit_routine'
  - 'delete_routine'
  - 'search_routine_by_oclock'
  - 'list_routine_by_week'
  - 'list_routine_by_date'
  - 'get_todo_list'
  - 'replace_todo_list'
  - 'update_todo_items'
  - 'get_task_brief'
  - 'read_task_brief'
  - 'search_task_brief'
  - 'edit_task_brief'
  - 'replace_task_brief'
  || CASE WHEN "tool_deny_list" ?| array['create_routine','edit_routine','delete_routine'] AND NOT "tool_deny_list" ? 'manage_routine' THEN '["manage_routine"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_deny_list" ?| array['search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_deny_list" ? 'query_routines' THEN '["query_routines"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_deny_list" ?| array['get_todo_list','replace_todo_list','update_todo_items'] AND NOT "tool_deny_list" ? 'manage_todo_list' THEN '["manage_todo_list"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_deny_list" ?| array['get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'] AND NOT "tool_deny_list" ? 'manage_task_brief' THEN '["manage_task_brief"]'::jsonb ELSE '[]'::jsonb END
WHERE "tool_deny_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date','get_todo_list','replace_todo_list','update_todo_items','get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'];--> statement-breakpoint
UPDATE "agent_settings"
SET "tool_deny_list" =
  "tool_deny_list"
  - 'create_routine'
  - 'edit_routine'
  - 'delete_routine'
  - 'search_routine_by_oclock'
  - 'list_routine_by_week'
  - 'list_routine_by_date'
  - 'get_todo_list'
  - 'replace_todo_list'
  - 'update_todo_items'
  - 'get_task_brief'
  - 'read_task_brief'
  - 'search_task_brief'
  - 'edit_task_brief'
  - 'replace_task_brief'
  || CASE WHEN "tool_deny_list" ?| array['create_routine','edit_routine','delete_routine'] AND NOT "tool_deny_list" ? 'manage_routine' THEN '["manage_routine"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_deny_list" ?| array['search_routine_by_oclock','list_routine_by_week','list_routine_by_date'] AND NOT "tool_deny_list" ? 'query_routines' THEN '["query_routines"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_deny_list" ?| array['get_todo_list','replace_todo_list','update_todo_items'] AND NOT "tool_deny_list" ? 'manage_todo_list' THEN '["manage_todo_list"]'::jsonb ELSE '[]'::jsonb END
  || CASE WHEN "tool_deny_list" ?| array['get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'] AND NOT "tool_deny_list" ? 'manage_task_brief' THEN '["manage_task_brief"]'::jsonb ELSE '[]'::jsonb END
WHERE "tool_deny_list" ?| array['create_routine','edit_routine','delete_routine','search_routine_by_oclock','list_routine_by_week','list_routine_by_date','get_todo_list','replace_todo_list','update_todo_items','get_task_brief','read_task_brief','search_task_brief','edit_task_brief','replace_task_brief'];
