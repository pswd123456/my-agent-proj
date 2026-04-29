import { z } from "zod";

import { searchSearxng } from "../web/index.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z
  .object({
    query: z.string().trim().min(1),
    maxResults: z.number().optional(),
    language: z.string().trim().optional(),
    timeRange: z.enum(["day", "month", "year"]).optional()
  })
  .strict();

export function createWebSearchTool(options?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): RuntimeTool {
  const env = options?.env ?? process.env;

  return {
    name: "web_search",
    description:
      "Search the web through the configured self-hosted SearXNG instance. Use this for current public web discovery before fetching pages.",
    family: "workspace-network",
    isReadOnly: true,
    hasExternalSideEffect: true,
    permissionProfile: "always-ask-user",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query."
        },
        maxResults: {
          type: "number",
          description:
            "Maximum number of results to return. Defaults to 5, max 10."
        },
        language: {
          type: "string",
          description: "Optional SearXNG language code."
        },
        timeRange: {
          enum: ["day", "month", "year"],
          description: "Optional SearXNG freshness filter."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async getPermissionRequest(input) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      return {
        summaryText: query
          ? `需要你的确认后才能搜索网页：${query}`
          : "需要你的确认后才能搜索网页。",
        contextNote: "web_search 会调用配置的 SearXNG 实例。"
      };
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "input",
          issue: issue.message
        }));
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Tool input validation failed.",
            validationErrors: issues
          }),
          `[web_search] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const baseUrl = env.SEARXNG_BASE_URL?.trim();
      if (!baseUrl) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "WEB_SEARCH_NOT_CONFIGURED",
            message: "SEARXNG_BASE_URL is not configured."
          }),
          "[web_search] not configured\n- set SEARXNG_BASE_URL"
        );
      }

      try {
        const value = parsed.data;
        const result = await searchSearxng(
          {
            query: value.query,
            ...(typeof value.maxResults === "number"
              ? { maxResults: value.maxResults }
              : {}),
            ...(value.language ? { language: value.language } : {}),
            ...(value.timeRange ? { timeRange: value.timeRange } : {})
          },
          {
            baseUrl,
            ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(context.abortSignal ? { abortSignal: context.abortSignal } : {})
          }
        );

        return successResult(
          createToolResult({
            ok: true,
            code: "WEB_SEARCH_OK",
            message: `Found ${result.resultCount} web results.`,
            data: result
          }),
          [
            "[web_search] success",
            `- query: ${result.query}`,
            `- results: ${result.resultCount}`,
            ...result.results
              .slice(0, 5)
              .map(
                (item, index) =>
                  `- ${index + 1}. ${item.title} (${item.domain})`
              )
          ].join("\n")
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "WEB_SEARCH_FAILED",
            message
          }),
          `[web_search] failed\n- ${message}`
        );
      }
    }
  };
}
