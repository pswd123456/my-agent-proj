import type {
  PendingPermissionRequest,
  PermissionRuleLists
} from "@ai-app-template/domain";
import {
  buildShellApprovalPatternCandidates,
  matchesShellCommandAllowPatterns,
  matchesShellCommandDenyPatterns,
  matchesShellCommandPattern
} from "@ai-app-template/domain";

export function matchesShellPattern(pattern: string, command: string): boolean {
  return matchesShellCommandPattern(pattern, command);
}

export function matchesPermissionRuleLists(
  input: PermissionRuleLists,
  toolName: string,
  command?: string
): { allow: boolean; ask: boolean; deny: boolean } {
  const shellCommand = typeof command === "string" ? command : "";
  const shellAllows = shellCommand
    ? matchesShellCommandAllowPatterns(input.shellAllowPatterns, shellCommand)
    : false;
  const shellDenies = shellCommand
    ? matchesShellCommandDenyPatterns(input.shellDenyPatterns, shellCommand)
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
  return buildShellApprovalPatternCandidates(command);
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
