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

export const PERMISSION_TOOL_OPTIONS = [
  "read_file",
  "list_directory",
  "search_text",
  "create_directory",
  "write_file",
  "copy_path",
  "move_path",
  "delete_path",
  "run_shell_command",
  "make_http_request",
  "create_routine",
  "edit_routine",
  "delete_routine",
  "search_routine_by_oclock",
  "list_routine_by_week",
  "list_routine_by_date",
  "ask_for_confirmation"
] as const;

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
  const toolDenyList = normalizeList(input?.toolDenyList);
  const deniedTools = new Set(toolDenyList);

  const toolAllowList = normalizeList(input?.toolAllowList).filter(
    (toolName) => !deniedTools.has(toolName)
  );
  const allowedTools = new Set(toolAllowList);

  const toolAskList = normalizeList(input?.toolAskList).filter(
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
