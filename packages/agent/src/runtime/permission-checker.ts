import type { PendingPermissionRequest } from "@ai-app-template/domain";

import { createToolResult } from "../tools/tool-result.js";
import type {
  RuntimeTool,
  ToolExecutionContext
} from "../tools/runtime-tool.js";
import {
  normalizeWorkspacePath,
  WorkspaceSandboxError
} from "../tools/workspace.js";
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
}): PendingPermissionRequest {
  return {
    toolCallId: input.toolCallId,
    toolName: input.tool.name,
    toolInput: input.toolInput,
    family: input.tool.family,
    permissionProfile: input.tool.permissionProfile,
    summaryText: input.summaryText,
    ...(input.contextNote ? { contextNote: input.contextNote } : {}),
    createdAt: new Date().toISOString()
  };
}

function enforceSandbox(
  tool: RuntimeTool,
  toolInput: Record<string, JsonValue>,
  executionContext: ToolExecutionContext
): PermissionBlockResult | null {
  if (tool.sandboxProfile !== "workspace-rooted") {
    return null;
  }

  const targets = tool.getSandboxTargets?.(toolInput) ?? [];
  for (const target of targets) {
    try {
      normalizeWorkspacePath(executionContext.workingDirectory, target);
    } catch (error) {
      if (error instanceof WorkspaceSandboxError) {
        return buildSandboxBlockedResult(
          tool.name,
          "Path escapes the working directory and is blocked by sandbox."
        );
      }

      throw error;
    }
  }

  return null;
}

export async function checkToolPermission(input: {
  toolCallId: string;
  tool: RuntimeTool;
  toolInput: Record<string, JsonValue>;
  executionContext: ToolExecutionContext;
}): Promise<PermissionCheckResult> {
  const sandboxBlock = enforceSandbox(
    input.tool,
    input.toolInput,
    input.executionContext
  );
  if (sandboxBlock) {
    return sandboxBlock;
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
