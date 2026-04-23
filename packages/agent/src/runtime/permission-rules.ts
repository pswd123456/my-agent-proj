import type {
  PendingPermissionRequest,
  PermissionRuleLists
} from "@ai-app-template/domain";

function splitShellCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const wildcard = escaped.replaceAll("*", ".*");
  return new RegExp(`^${wildcard}$`);
}

export function matchesShellPattern(pattern: string, command: string): boolean {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return false;
  }

  return globToRegExp(normalizedPattern).test(command.trim());
}

export function matchesPermissionRuleLists(
  input: PermissionRuleLists,
  toolName: string,
  command?: string
): { allow: boolean; ask: boolean; deny: boolean } {
  const shellCommand = typeof command === "string" ? command : "";
  const shellAllows = shellCommand
    ? input.shellAllowPatterns.some((pattern) =>
        matchesShellPattern(pattern, shellCommand)
      )
    : false;
  const shellDenies = shellCommand
    ? input.shellDenyPatterns.some((pattern) =>
        matchesShellPattern(pattern, shellCommand)
      )
    : false;

  const toolAllows = input.toolAllowList.includes(toolName);
  const toolAsks = input.toolAskList.includes(toolName);
  const toolDenies = input.toolDenyList.includes(toolName);

  return {
    allow: shellAllows || toolAllows,
    ask: !shellAllows && !toolAllows && toolAsks,
    deny: shellDenies || toolDenies
  };
}

export function deriveShellApprovalPatterns(command: string): string[] {
  const tokens = splitShellCommand(command);
  if (tokens.length === 0) {
    return [];
  }

  const first = `${tokens[0]} *`;
  if (tokens.length === 1) {
    const singleToken = tokens[0];
    return singleToken ? [singleToken] : [];
  }

  const second = `${tokens.slice(0, 2).join(" ")} *`;
  if (first === second) {
    return [first];
  }

  return [first, second];
}

export function deriveSessionApprovalRules(
  request: PendingPermissionRequest
): PermissionRuleLists {
  if (request.toolName === "run_shell_command") {
    const command =
      typeof request.toolInput.command === "string"
        ? request.toolInput.command
        : "";
    const patterns = deriveShellApprovalPatterns(command);
    const allowPattern = patterns[patterns.length - 1];
    if (!allowPattern) {
      return {
        shellAllowPatterns: [],
        shellDenyPatterns: [],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      };
    }
    return {
      shellAllowPatterns: [allowPattern],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    };
  }

  return {
    shellAllowPatterns: [],
    shellDenyPatterns: [],
    toolAllowList: [request.toolName],
    toolAskList: [],
    toolDenyList: []
  };
}
