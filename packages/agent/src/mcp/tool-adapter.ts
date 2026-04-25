import type { Client } from "@modelcontextprotocol/sdk/client";
import type {
  Tool
} from "@modelcontextprotocol/sdk/types";

import type { JsonValue } from "../types.js";
import type { RuntimeTool } from "../tools/runtime-tool.js";
import { createToolResult, failureResult, successResult } from "../tools/tool-result.js";

function toReadableSegment(value: string): string {
  const readable = value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return readable || "unnamed";
}

function encodeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unnamed";
  }

  let encoded = "";
  for (const character of trimmed) {
    if (/^[A-Za-z0-9]$/.test(character)) {
      encoded += character;
      continue;
    }

    encoded += `_${character.codePointAt(0)?.toString(16) ?? "0"}_`;
  }

  return encoded;
}

function sanitizeJsonValue(value: unknown, depth = 6): JsonValue {
  if (depth <= 0) {
    return "[truncated]";
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item, depth - 1));
  }
  if (typeof value === "object") {
    const next: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "undefined") {
        continue;
      }
      next[key] = sanitizeJsonValue(item, depth - 1);
    }
    return next;
  }
  return String(value);
}

type McpCallToolResult = Extract<
  Awaited<ReturnType<Client["callTool"]>>,
  { content: unknown }
>;

type McpContentBlock = McpCallToolResult["content"][number];

function hasContentResult(
  value: Awaited<ReturnType<Client["callTool"]>>
): value is McpCallToolResult {
  return Array.isArray((value as { content?: unknown }).content);
}

function serializeContentBlock(block: McpContentBlock): JsonValue {
  if (block.type === "text") {
    return {
      type: block.type,
      text: block.text
    };
  }
  if (block.type === "image" || block.type === "audio") {
    return {
      type: block.type,
      mimeType: block.mimeType,
      dataLength: block.data.length
    };
  }
  if (block.type === "resource") {
    if ("text" in block.resource) {
      return {
        type: block.type,
        resource: {
          uri: block.resource.uri,
          mimeType: block.resource.mimeType ?? null,
          text: block.resource.text
        }
      };
    }
    return {
      type: block.type,
      resource: {
        uri: block.resource.uri,
        mimeType: block.resource.mimeType ?? null,
        blobLength: block.resource.blob.length
      }
    };
  }

  return sanitizeJsonValue(block);
}

function summarizeContentBlocks(content: McpCallToolResult["content"]): string {
  const parts = content.map((block) => {
    if (block.type === "text") {
      return block.text.trim();
    }
    if (block.type === "image") {
      return `[image ${block.mimeType}]`;
    }
    if (block.type === "audio") {
      return `[audio ${block.mimeType}]`;
    }
    if (block.type === "resource") {
      return `[resource ${block.resource.uri}]`;
    }
    return `[${block.type}]`;
  });

  return parts.filter(Boolean).join("\n").trim();
}

export function namespaceMcpToolName(
  serverName: string,
  toolName: string
): string {
  return `mcp__${toReadableSegment(serverName)}__${encodeSegment(
    serverName
  )}__${toReadableSegment(toolName)}__${encodeSegment(toolName)}`;
}

function buildSuccessDisplayText(
  namespacedToolName: string,
  serverName: string,
  toolName: string
): string {
  return `[${namespacedToolName}] success\n- ${serverName}.${toolName}`;
}

function buildFailureDisplayText(
  namespacedToolName: string,
  serverName: string,
  toolName: string,
  message?: string
): string {
  const suffix = message ? `\n- ${message}` : "";
  return `[${namespacedToolName}] failed\n- ${serverName}.${toolName}${suffix}`;
}

function toToolResultData(
  serverName: string,
  toolName: string,
  result: McpCallToolResult
): JsonValue {
  return {
    serverName,
    toolName,
    isError: result.isError === true,
    content: result.content.map((block) => serializeContentBlock(block)),
    structuredContent:
      typeof result.structuredContent === "undefined"
        ? null
        : sanitizeJsonValue(result.structuredContent)
  };
}

export function createMcpRuntimeTool(input: {
  serverName: string;
  definition: Tool;
  client: Client;
}): RuntimeTool {
  const namespacedToolName = namespaceMcpToolName(
    input.serverName,
    input.definition.name
  );
  const description =
    input.definition.description?.trim() ||
    input.definition.title?.trim() ||
    `Call MCP tool ${input.definition.name} from server ${input.serverName}.`;

  return {
    name: namespacedToolName,
    description,
    family: "mcp",
    isReadOnly: input.definition.annotations?.readOnlyHint === true,
    hasExternalSideEffect: input.definition.annotations?.readOnlyHint !== true,
    permissionProfile: "always-ask-user",
    sandboxProfile: "none",
    inputSchema: input.definition.inputSchema,
    async getPermissionRequest() {
      return {
        summaryText: `需要你的确认后才能调用 MCP 工具：${input.serverName}.${input.definition.name}`,
        contextNote: "工作区 MCP 工具默认走总是审批。"
      };
    },
    validate(toolInput) {
      if (Array.isArray(toolInput) || typeof toolInput !== "object") {
        return {
          ok: false,
          issues: [
            {
              field: "input",
              issue: "tool input must be a JSON object."
            }
          ]
        };
      }

      return {
        ok: true,
        value: toolInput
      };
    },
    async execute(toolInput) {
      try {
        const rawResult = await input.client.callTool({
          name: input.definition.name,
          arguments: toolInput
        });
        if (!hasContentResult(rawResult)) {
          return successResult(
            createToolResult({
              ok: true,
              code: "MCP_TOOL_TASK_RESULT",
              message: "MCP tool returned a task-style result wrapper.",
              data: {
                serverName: input.serverName,
                toolName: input.definition.name,
                toolResult: sanitizeJsonValue(rawResult.toolResult)
              }
            }),
            buildSuccessDisplayText(
              namespacedToolName,
              input.serverName,
              input.definition.name
            )
          );
        }
        const result = rawResult;
        const summary =
          summarizeContentBlocks(result.content) ||
          (result.isError
            ? `MCP tool ${input.definition.name} returned an error.`
            : `MCP tool ${input.definition.name} completed.`);
        const toolResult = createToolResult({
          ok: result.isError !== true,
          code: result.isError === true ? "MCP_TOOL_ERROR" : "MCP_TOOL_OK",
          message: summary,
          data: toToolResultData(
            input.serverName,
            input.definition.name,
            result
          )
        });

        return result.isError === true
          ? failureResult(
              toolResult,
              buildFailureDisplayText(
                namespacedToolName,
                input.serverName,
                input.definition.name
              )
            )
          : successResult(
              toolResult,
              buildSuccessDisplayText(
                namespacedToolName,
                input.serverName,
                input.definition.name
              )
            );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown MCP transport error.";
        return failureResult(
          createToolResult({
            ok: false,
            code: "MCP_TRANSPORT_ERROR",
            message,
            data: {
              serverName: input.serverName,
              toolName: input.definition.name
            }
          }),
          buildFailureDisplayText(
            namespacedToolName,
            input.serverName,
            input.definition.name,
            message
          )
        );
      }
    }
  };
}
