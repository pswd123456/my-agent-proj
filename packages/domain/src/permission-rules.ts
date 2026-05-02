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

export const TODO_TOOL_NAMES = [
  "get_todo_list",
  "replace_todo_list",
  "update_todo_items"
] as const;

export const PLANNING_STATE_TOOL_NAMES = TODO_TOOL_NAMES;

export const PERMISSION_TOOL_OPTIONS = [
  "ask_user_question",
  "delegate_agent",
  "edit_task_brief",
  "get_current_time",
  "get_task_brief",
  ...PLANNING_STATE_TOOL_NAMES,
  "manage_capability_packs",
  "read_task_brief",
  "replace_task_brief",
  "load_skill",
  "search_task_brief",
  "search_skill",
  "apply_patch",
  "read_file",
  "list_directory",
  "find_files",
  "search_text",
  "create_directory",
  "write_file",
  "manage_path",
  "delete_file",
  "delete_path",
  "git_status",
  "git_diff",
  "git_diff_cached",
  "run_shell_command",
  "make_http_request",
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
    toolName !== "run_shell_command" && toolName !== "make_http_request"
) as readonly string[];

const SHELL_LINE_CONTINUATION_PATTERN = /\\\r?\n[ \t]*/g;

interface AnalyzedShellPattern {
  canonicalCommand: string;
  segments: string[];
  operators: string[];
  mode: "simple" | "structured" | "exact-only";
}

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

function collapseShellWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function flushShellSegment(
  buffer: string,
  segments: string[],
  normalizedSource: string
): { ok: boolean; nextBuffer: string } {
  const segment = collapseShellWhitespace(buffer);
  if (!segment) {
    return {
      ok: false,
      nextBuffer: normalizedSource
    };
  }

  segments.push(segment);
  return {
    ok: true,
    nextBuffer: ""
  };
}

function analyzeShellPattern(command: string): AnalyzedShellPattern {
  const normalizedSource = command
    .replaceAll(SHELL_LINE_CONTINUATION_PATTERN, " ")
    .trim();
  if (!normalizedSource) {
    return {
      canonicalCommand: "",
      segments: [],
      operators: [],
      mode: "simple"
    };
  }

  const exactOnlyFallback = (): AnalyzedShellPattern => ({
    canonicalCommand: collapseShellWhitespace(normalizedSource),
    segments: [collapseShellWhitespace(normalizedSource)].filter(Boolean),
    operators: [],
    mode: "exact-only"
  });

  let buffer = "";
  const segments: string[] = [];
  const operators: string[] = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < normalizedSource.length; index += 1) {
    const current = normalizedSource[index] ?? "";
    const next = normalizedSource[index + 1] ?? "";

    if (escaped) {
      buffer += current;
      escaped = false;
      continue;
    }

    if (current === "\\") {
      buffer += current;
      escaped = true;
      continue;
    }

    if (inSingleQuote) {
      buffer += current;
      if (current === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      buffer += current;
      if (current === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (current === "'") {
      buffer += current;
      inSingleQuote = true;
      continue;
    }

    if (current === '"') {
      buffer += current;
      inDoubleQuote = true;
      continue;
    }

    if (
      current === "`" ||
      current === ">" ||
      current === "<" ||
      (current === "$" && next === "(")
    ) {
      return exactOnlyFallback();
    }

    let operator: string | null = null;
    let skipNext = false;
    if (current === "&" && next === "&") {
      operator = "&&";
      skipNext = true;
    } else if (current === "|" && next === "|") {
      operator = "||";
      skipNext = true;
    } else if (current === "|") {
      operator = "|";
    } else if (current === ";") {
      operator = ";";
    } else if (current === "&") {
      operator = "&";
    } else if (current === "\n" || current === "\r") {
      operator = ";";
    }

    if (operator) {
      const flushed = flushShellSegment(buffer, segments, normalizedSource);
      if (!flushed.ok) {
        return exactOnlyFallback();
      }
      buffer = flushed.nextBuffer;
      operators.push(operator);
      if (skipNext) {
        index += 1;
      }
      continue;
    }

    buffer += current;
  }

  const finalSegment = collapseShellWhitespace(buffer);
  if (!finalSegment) {
    return exactOnlyFallback();
  }
  segments.push(finalSegment);

  if (operators.length !== Math.max(0, segments.length - 1)) {
    return exactOnlyFallback();
  }

  if (operators.length === 0) {
    return {
      canonicalCommand: segments[0] ?? "",
      segments,
      operators,
      mode: "simple"
    };
  }

  const canonicalCommand = segments.reduce((result, segment, index) => {
    if (index === 0) {
      return segment;
    }
    const operator = operators[index - 1] ?? "";
    return `${result} ${operator} ${segment}`.trim();
  }, "");

  return {
    canonicalCommand,
    segments,
    operators,
    mode: "structured"
  };
}

function buildSegmentApprovalPattern(
  segment: string,
  tokenCount: number
): string | null {
  const tokens = segment
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  if (tokens.length === 1) {
    return tokens[0] ?? null;
  }

  const boundedTokenCount = Math.max(1, tokenCount);
  const headLength = Math.min(tokens.length, boundedTokenCount);
  const head = tokens.slice(0, headLength);
  if (head.length === 0) {
    return null;
  }

  if (tokens.length <= headLength) {
    return head.join(" ");
  }

  return `${head.join(" ")} *`;
}

function joinSegmentPatterns(
  segments: string[],
  operators: string[],
  tokenCount: number
): string | null {
  if (segments.length === 0) {
    return null;
  }

  const segmentPatterns = segments.map((segment) =>
    buildSegmentApprovalPattern(segment, tokenCount)
  );
  if (segmentPatterns.some((pattern) => !pattern)) {
    return null;
  }

  return segmentPatterns.reduce((result, pattern, index) => {
    if (index === 0) {
      return pattern ?? "";
    }
    const operator = operators[index - 1] ?? "";
    return `${result} ${operator} ${pattern ?? ""}`.trim();
  }, "");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const wildcard = escaped.replaceAll("*", ".*");
  return new RegExp(`^${wildcard}$`);
}

export function matchesShellCommandPattern(
  pattern: string,
  command: string
): boolean {
  const patternAnalysis = analyzeShellPattern(pattern);
  const commandAnalysis = analyzeShellPattern(command);
  if (!patternAnalysis.canonicalCommand || !commandAnalysis.canonicalCommand) {
    return false;
  }

  if (
    patternAnalysis.mode === "exact-only" ||
    commandAnalysis.mode === "exact-only"
  ) {
    return (
      patternAnalysis.canonicalCommand === commandAnalysis.canonicalCommand
    );
  }

  if (patternAnalysis.mode !== commandAnalysis.mode) {
    return false;
  }

  if (patternAnalysis.mode === "simple") {
    return globToRegExp(patternAnalysis.canonicalCommand).test(
      commandAnalysis.canonicalCommand
    );
  }

  if (
    patternAnalysis.operators.length !== commandAnalysis.operators.length ||
    patternAnalysis.segments.length !== commandAnalysis.segments.length
  ) {
    return false;
  }

  for (let index = 0; index < patternAnalysis.operators.length; index += 1) {
    if (patternAnalysis.operators[index] !== commandAnalysis.operators[index]) {
      return false;
    }
  }

  return patternAnalysis.segments.every((segmentPattern, index) =>
    globToRegExp(segmentPattern).test(commandAnalysis.segments[index] ?? "")
  );
}

export function matchesShellCommandDenyPatterns(
  patterns: string[],
  command: string
): boolean {
  const commandAnalysis = analyzeShellPattern(command);
  if (!commandAnalysis.canonicalCommand) {
    return false;
  }

  return patterns.some((pattern) => {
    if (matchesShellCommandPattern(pattern, command)) {
      return true;
    }

    if (commandAnalysis.mode !== "structured") {
      return false;
    }

    return commandAnalysis.segments.some((segment) =>
      matchesShellCommandPattern(pattern, segment)
    );
  });
}

export function matchesShellCommandAllowPatterns(
  patterns: string[],
  command: string
): boolean {
  const commandAnalysis = analyzeShellPattern(command);
  if (!commandAnalysis.canonicalCommand) {
    return false;
  }

  if (
    patterns.some((pattern) => matchesShellCommandPattern(pattern, command))
  ) {
    return true;
  }

  if (commandAnalysis.mode !== "structured") {
    return false;
  }

  return commandAnalysis.segments.every((segment) =>
    patterns.some((pattern) => matchesShellCommandPattern(pattern, segment))
  );
}

export function buildShellApprovalPatternCandidates(command: string): string[] {
  const analysis = analyzeShellPattern(command);
  if (!analysis.canonicalCommand) {
    return [];
  }

  const patterns: string[] = [];
  const pushPattern = (pattern: string | null) => {
    const normalizedPattern = pattern?.trim();
    if (!normalizedPattern || patterns.includes(normalizedPattern)) {
      return;
    }
    patterns.push(normalizedPattern);
  };

  if (analysis.mode === "simple") {
    pushPattern(buildSegmentApprovalPattern(analysis.segments[0] ?? "", 1));
    pushPattern(buildSegmentApprovalPattern(analysis.segments[0] ?? "", 2));
    pushPattern(buildSegmentApprovalPattern(analysis.segments[0] ?? "", 3));
    pushPattern(analysis.canonicalCommand);
    return patterns;
  }

  if (analysis.mode === "structured") {
    pushPattern(joinSegmentPatterns(analysis.segments, analysis.operators, 2));
    pushPattern(joinSegmentPatterns(analysis.segments, analysis.operators, 3));
  }

  pushPattern(analysis.canonicalCommand);
  return patterns;
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
