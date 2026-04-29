import { z } from "zod";

import { fetchWebPage } from "../web/index.js";
import type { BrowserRenderInput, BrowserRenderResult } from "../web/browser-render.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z
  .object({
    url: z.string().trim().url(),
    format: z.enum(["markdown", "text"]).optional(),
    maxChars: z.number().optional(),
    timeoutMs: z.number().optional()
  })
  .strict();

function validateInput(input: Record<string, unknown>) {
  const validation = validateWithSchema(schema, input);
  if (!validation.ok) {
    return validation;
  }

  const url = typeof input.url === "string" ? input.url.trim() : "";
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return {
        ok: false,
        issues: [
          { field: "url", issue: "url must use http or https protocol." }
        ]
      };
    }
  } catch {
    return {
      ok: false,
      issues: [{ field: "url", issue: "url must be a valid URL." }]
    };
  }

  return validation;
}

export function createWebFetchTool(options?: {
  fetchImpl?: typeof fetch;
  renderImpl?:
    | ((input: BrowserRenderInput) => Promise<BrowserRenderResult>)
    | undefined;
}): RuntimeTool {
  return {
    name: "web_fetch",
    description:
      "Fetch a public HTTP or HTTPS page, extract readable markdown or text, and fall back to browser rendering for JS-heavy pages.",
    family: "workspace-network",
    isReadOnly: true,
    hasExternalSideEffect: true,
    permissionProfile: "always-ask-user",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to fetch."
        },
        format: {
          enum: ["markdown", "text"],
          description: "Output format. Defaults to markdown."
        },
        maxChars: {
          type: "number",
          description:
            "Maximum content characters. Defaults to 12000, max 60000."
        },
        timeoutMs: {
          type: "number",
          description:
            "Request timeout in milliseconds. Defaults to 20000, max 60000."
        }
      },
      required: ["url"],
      additionalProperties: false
    },
    async getPermissionRequest(input) {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      return {
        summaryText: url
          ? `需要你的确认后才能抓取网页：${url}`
          : "需要你的确认后才能抓取网页。",
        contextNote:
          "web_fetch 会优先静态抓取，并在需要时尝试浏览器渲染兜底。"
      };
    },
    validate(input) {
      return validateInput(input);
    },
    async execute(input, context) {
      const validation = validateInput(input);
      if (!validation.ok) {
        const issues = validation.issues ?? [];
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Tool input validation failed.",
            validationErrors: issues
          }),
          `[web_fetch] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      try {
        const value = validation.value as z.infer<typeof schema>;
        const result = await fetchWebPage(
          {
            url: value.url,
            ...(value.format ? { format: value.format } : {}),
            ...(typeof value.maxChars === "number"
              ? { maxChars: value.maxChars }
              : {}),
            ...(typeof value.timeoutMs === "number"
              ? { timeoutMs: value.timeoutMs }
              : {})
          },
          {
            ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options?.renderImpl ? { renderImpl: options.renderImpl } : {}),
            ...(context.abortSignal ? { abortSignal: context.abortSignal } : {})
          }
        );

        return successResult(
          createToolResult({
            ok: true,
            code: "WEB_FETCH_OK",
            message: `Fetched ${result.title || result.finalUrl}.`,
            data: result
          }),
          [
            "[web_fetch] success",
            `- provider: ${result.provider}`,
            `- title: ${result.title}`,
            `- url: ${result.finalUrl}`,
            `- format: ${result.format}`,
            `- extraction: ${result.extraction}`,
            `- truncated: ${result.truncated ? "yes" : "no"}`
          ].join("\n")
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "WEB_FETCH_FAILED",
            message
          }),
          `[web_fetch] failed\n- ${message}`
        );
      }
    }
  };
}
