import type { JsonValue } from "../types.js";

import type { RuntimeTool } from "./runtime-tool.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";
import { truncateText } from "./workspace.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

function isHeadersRecord(
  value: JsonValue | undefined
): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toHeaders(
  value: Record<string, JsonValue> | undefined
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value ?? {})) {
    if (typeof headerValue === "string") {
      headers[key] = headerValue;
    }
  }

  return headers;
}

export function createMakeHttpRequestTool(): RuntimeTool {
  return {
    name: "make_http_request",
    description: buildToolDescription({
      usageScenarios: [
        "Call an external HTTP or HTTPS endpoint after approval.",
        "Fetch or post data when the task genuinely requires network access."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "url",
          type: "string",
          required: true,
          description: "HTTP or HTTPS URL."
        }),
        describeObjectProperty({
          name: "method",
          type: "string",
          description: "HTTP method; defaults to GET."
        }),
        describeObjectProperty({
          name: "headers",
          type: "object",
          description: "Optional string headers."
        }),
        describeObjectProperty({
          name: "body",
          type: "string",
          description: "Optional request body."
        }),
        describeObjectProperty({
          name: "timeoutMs",
          type: "number",
          description: "Optional timeout in milliseconds."
        })
      ],
      constraints: [
        "Every network request requires user approval.",
        "Only http and https URLs are supported.",
        "Response bodies are truncated to a safe size."
      ],
      examples: [
        '{"url":"https://example.com"}',
        '{"url":"https://api.example.com/items","method":"POST","headers":{"Content-Type":"application/json"},"body":"{\\"name\\":\\"demo\\"}","timeoutMs":10000}'
      ]
    }),
    family: "workspace-network",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "always-ask-user",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL."
        },
        method: {
          type: "string",
          description: "HTTP method, defaults to GET."
        },
        headers: {
          type: "object",
          description: "Optional request headers."
        },
        body: {
          type: "string",
          description: "Optional request body."
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds."
        }
      },
      required: ["url"],
      additionalProperties: false
    },
    async getPermissionRequest(input) {
      const method =
        typeof input.method === "string" && input.method.trim()
          ? input.method.trim().toUpperCase()
          : "GET";
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (!url) {
        return null;
      }

      return {
        summaryText: `需要你的确认后才能发起网络请求：${method} ${url}`,
        contextNote: "Stage 4 对 network 工具固定采用总是审批。"
      };
    },
    validate(input) {
      const url = input.url;
      if (typeof url !== "string" || url.trim().length === 0) {
        return {
          ok: false,
          issues: [{ field: "url", issue: "url is required." }]
        };
      }

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

      if (
        typeof input.body !== "undefined" &&
        typeof input.body !== "string"
      ) {
        return {
          ok: false,
          issues: [{ field: "body", issue: "body must be a string." }]
        };
      }

      return { ok: true, value: input };
    },
    async execute(input, context) {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (!url) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing URL.",
            validationErrors: [{ field: "url", issue: "url is required." }]
          }),
          "[make_http_request] invalid input"
        );
      }

      const controller = new AbortController();
      let timedOut = false;
      const timeoutMs =
        typeof input.timeoutMs === "number" && input.timeoutMs > 0
          ? Math.floor(input.timeoutMs)
          : 20_000;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onAbort = () => {
        controller.abort();
      };

      if (context.abortSignal?.aborted) {
        controller.abort();
      } else if (context.abortSignal) {
        context.abortSignal.addEventListener("abort", onAbort, {
          once: true
        });
      }

      try {
        const method =
          typeof input.method === "string" && input.method.trim()
            ? input.method.trim().toUpperCase()
            : "GET";
        const response = await fetch(url, {
          method,
          headers: toHeaders(
            isHeadersRecord(input.headers) ? input.headers : undefined
          ),
          ...(typeof input.body === "string" ? { body: input.body } : {}),
          signal: controller.signal
        });

        const responseText = await response.text();
        const toolResult = createToolResult({
          ok: response.ok,
          code: response.ok ? "HTTP_REQUEST_OK" : "HTTP_REQUEST_ERROR",
          message: response.ok
            ? "HTTP request completed."
            : `HTTP request returned status ${response.status}.`,
          data: {
            url,
            method,
            status: response.status,
            ok: response.ok,
            body: truncateText(responseText, 16_000)
          }
        });

        if (!response.ok) {
          return failureResult(
            toolResult,
            `[make_http_request] failed\n- ${method} ${url} -> ${response.status}`
          );
        }

        return successResult(
          toolResult,
          `[make_http_request] success\n- ${method} ${url}`
        );
      } catch (error) {
        if (controller.signal.aborted && !timedOut) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "HTTP_REQUEST_INTERRUPTED",
              message: "Interrupted by user."
            }),
            "[make_http_request] interrupted\n- interrupted by user"
          );
        }

        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "HTTP_REQUEST_FAILED",
            message
          }),
          `[make_http_request] failed\n- ${message}`
        );
      } finally {
        clearTimeout(timeout);
        context.abortSignal?.removeEventListener("abort", onAbort);
      }
    }
  };
}
