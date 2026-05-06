import type { ToolValidationIssue } from "@ai-app-template/domain";

export function getWorkspacePathSandboxTargets(input: {
  path?: unknown;
}): string[] {
  return [
    typeof input.path === "string" && input.path.length > 0 ? input.path : "."
  ];
}

export function validateRequiredWorkspacePath(input: {
  path?: unknown;
}): ToolValidationIssue[] {
  return typeof input.path === "string" && input.path.trim().length > 0
    ? []
    : [{ field: "path", issue: "path is required." }];
}
