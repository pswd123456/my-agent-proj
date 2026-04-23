import type { PendingPermissionRequest } from "@ai-app-template/domain";

import { createToolResult } from "../tools/tool-result.js";
import type {
  RuntimeTool,
  ToolExecutionContext
} from "../tools/runtime-tool.js";
import { matchesPermissionRuleLists } from "./permission-rules.js";
import type { JsonValue } from "../types.js";

export interface PermissionAllowResult {
  decision: "allow";
}

export interface PermissionAskUserResult {
  decision: "ask_user";
  request: PendingPermissionRequest;
}

export interface PermissionBlockResult {
  decision: "block";
  reason: string;
  content: string;
  displayText: string;
}

export type PermissionCheckResult =
  | PermissionAllowResult
  | PermissionAskUserResult
  | PermissionBlockResult;

function buildFallbackPermissionSummary(tool: RuntimeTool): string {
  if (tool.family === "workspace-shell") {
    return `需要你的确认后才能执行 shell 命令：${tool.name}`;
  }
  if (tool.family === "workspace-network") {
    return `需要你的确认后才能发起网络请求：${tool.name}`;
  }
  return `需要你的确认后才能执行高风险工具：${tool.name}`;
}

function buildSandboxBlockedResult(
  toolName: string,
  reason: string
): PermissionBlockResult {
  return {
    decision: "block",
    reason,
    content: JSON.stringify(
      createToolResult({
        ok: false,
        code: "SANDBOX_BLOCKED",
        message: reason
      }),
      null,
      2
    ),
    displayText: `[${toolName}] blocked\n- ${reason}`
  };
}

function createPendingPermissionRequest(input: {
  toolCallId: string;
  tool: RuntimeTool;
  toolInput: Record<string, JsonValue>;
  summaryText: string;
  contextNote?: string;
  allowWorkspaceEscape?: boolean;
}): PendingPermissionRequest {
  return {
    toolCallId: input.toolCallId,
    toolName: input.tool.name,
    toolInput: input.toolInput,
    family: input.tool.family,
    permissionProfile: input.tool.permissionProfile,
    summaryText: input.summaryText,
    ...(input.contextNote ? { contextNote: input.contextNote } : {}),
    ...(typeof input.allowWorkspaceEscape === "boolean"
      ? { allowWorkspaceEscape: input.allowWorkspaceEscape }
      : {}),
    createdAt: new Date().toISOString()
  };
}

async function buildPermissionAskResult(input: {
  toolCallId: string;
  tool: RuntimeTool;
  toolInput: Record<string, JsonValue>;
  executionContext: ToolExecutionContext;
}): Promise<PermissionAskUserResult> {
  const permissionRequest =
    (await input.tool.getPermissionRequest?.(
      input.toolInput,
      input.executionContext
    )) ?? null;

  return {
    decision: "ask_user",
    request: createPendingPermissionRequest({
      toolCallId: input.toolCallId,
      tool: input.tool,
      toolInput: input.toolInput,
      summaryText:
        permissionRequest?.summaryText ??
        buildFallbackPermissionSummary(input.tool),
      ...(permissionRequest?.contextNote
        ? { contextNote: permissionRequest.contextNote }
        : {})
    })
  };
}

export async function checkToolPermission(input: {
  toolCallId: string;
  tool: RuntimeTool;
  toolInput: Record<string, JsonValue>;
  executionContext: ToolExecutionContext;
}): Promise<PermissionCheckResult> {
  const shellCommand =
    input.tool.name === "run_shell_command" &&
    typeof input.toolInput.command === "string"
      ? input.toolInput.command
      : undefined;
  const ruleMatch = matchesPermissionRuleLists(
    {
      shellAllowPatterns:
        input.executionContext.sessionContext.shellAllowPatterns,
      shellDenyPatterns:
        input.executionContext.sessionContext.shellDenyPatterns,
      toolAllowList: input.executionContext.sessionContext.toolAllowList,
      toolAskList: input.executionContext.sessionContext.toolAskList,
      toolDenyList: input.executionContext.sessionContext.toolDenyList
    },
    input.tool.name,
    shellCommand
  );
  if (ruleMatch.deny) {
    return buildSandboxBlockedResult(
      input.tool.name,
      "Permission denied by session or user settings."
    );
  }
  if (ruleMatch.ask) {
    return buildPermissionAskResult(input);
  }
  if (ruleMatch.allow) {
    return { decision: "allow" };
  }

  if (input.tool.permissionProfile === "allow") {
    return { decision: "allow" };
  }

  if (
    input.executionContext.sessionContext.yoloMode &&
    input.tool.family === "workspace-file" &&
    input.tool.permissionProfile === "destructive-only"
  ) {
    return { decision: "allow" };
  }

  const permissionRequest =
    (await input.tool.getPermissionRequest?.(
      input.toolInput,
      input.executionContext
    )) ?? null;

  if (
    input.tool.permissionProfile === "destructive-only" &&
    permissionRequest === null
  ) {
    return { decision: "allow" };
  }

  return buildPermissionAskResult(input);
}
