export interface PermissionRuleLists {
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
}

export interface PermissionRuleInput {
  shellAllowPatterns?: unknown;
  shellDenyPatterns?: unknown;
  toolAllowList?: unknown;
  toolAskList?: unknown;
  toolDenyList?: unknown;
}

export interface SettingsPermissionToolOption {
  name: string;
  family: string;
  capabilityPack: string | null;
}

export const PERMISSION_TOOL_OPTIONS = [
  "ask_user_question",
  "delegate_agent",
  "edit_task_brief",
  "get_current_time",
  "get_task_brief",
  "get_todo_list",
  "manage_capability_packs",
  "read_task_brief",
  "replace_task_brief",
  "replace_todo_list",
  "load_skill",
  "search_task_brief",
  "search_skill",
  "update_todo_items",
  "apply_patch",
  "read_file",
  "list_directory",
  "find_files",
  "search_text",
  "create_directory",
  "write_file",
  "copy_path",
  "move_path",
  "delete_file",
  "delete_path",
  "git_status",
  "git_diff",
  "git_diff_cached",
  "run_shell_command",
  "make_http_request",
  "web_search",
  "web_fetch",
  "lsp_hover",
  "lsp_go_to_definition",
  "lsp_find_references",
  "lsp_document_symbols",
  "lsp_workspace_symbols",
  "lsp_diagnostics",
  "create_routine",
  "edit_routine",
  "delete_routine",
  "search_routine_by_oclock",
  "list_routine_by_week",
  "list_routine_by_date",
  "ask_for_confirmation"
] as const;

export const SETTINGS_PERMISSION_TOOL_OPTIONS = PERMISSION_TOOL_OPTIONS.filter(
  (toolName) =>
    toolName !== "run_shell_command" &&
    toolName !== "make_http_request" &&
    toolName !== "web_search" &&
    toolName !== "web_fetch"
) as readonly string[];

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeToolList(
  values: unknown,
  allowedTools?: ReadonlySet<string>
): string[] {
  const normalized = normalizeList(values);
  if (!allowedTools) {
    return normalized;
  }

  return normalized.filter((toolName) => allowedTools.has(toolName));
}

export function createPermissionRuleLists(): PermissionRuleLists {
  return {
    shellAllowPatterns: [],
    shellDenyPatterns: [],
    toolAllowList: [],
    toolAskList: [],
    toolDenyList: []
  };
}

export function normalizePermissionRuleLists(
  input?: PermissionRuleInput | null
): PermissionRuleLists {
  const toolDenyList = normalizeToolList(input?.toolDenyList);
  const deniedTools = new Set(toolDenyList);

  const toolAllowList = normalizeToolList(input?.toolAllowList).filter(
    (toolName) => !deniedTools.has(toolName)
  );
  const allowedTools = new Set(toolAllowList);

  const toolAskList = normalizeToolList(input?.toolAskList).filter(
    (toolName) => !deniedTools.has(toolName) && !allowedTools.has(toolName)
  );

  return {
    shellAllowPatterns: normalizeList(input?.shellAllowPatterns),
    shellDenyPatterns: normalizeList(input?.shellDenyPatterns),
    toolAllowList,
    toolAskList,
    toolDenyList
  };
}

export function normalizeSettingsPermissionRuleLists(
  input?: PermissionRuleInput | null,
  allowedToolNames: readonly string[] = SETTINGS_PERMISSION_TOOL_OPTIONS
): PermissionRuleLists {
  const allowedTools = new Set<string>(allowedToolNames);
  const toolDenyList = normalizeToolList(input?.toolDenyList, allowedTools);
  const deniedTools = new Set(toolDenyList);

  const toolAllowList = normalizeToolList(
    input?.toolAllowList,
    allowedTools
  ).filter((toolName) => !deniedTools.has(toolName));
  const allowedToolSet = new Set(toolAllowList);

  const toolAskList = normalizeToolList(
    input?.toolAskList,
    allowedTools
  ).filter(
    (toolName) => !deniedTools.has(toolName) && !allowedToolSet.has(toolName)
  );

  return {
    shellAllowPatterns: normalizeList(input?.shellAllowPatterns),
    shellDenyPatterns: normalizeList(input?.shellDenyPatterns),
    toolAllowList,
    toolAskList,
    toolDenyList
  };
}
