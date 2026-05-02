import type { DomainJsonValue, ToolResult, ToolValidationIssue } from "@ai-app-template/domain";

import { z } from "zod";

import type {
  ToolExecutionResult,
  ToolValidationResult
} from "./runtime-tool.js";
import type { ToolResultDetails } from "../types.js";

export function mapZodIssues(
  issues: readonly z.ZodIssue[]
): ToolValidationIssue[] {
  return issues.map((issue) => ({
    field: issue.path.join(".") || "input",
    issue: issue.message
  }));
}

export function formatValidationErrors(
  issues: readonly ToolValidationIssue[]
): string {
  return issues.map((issue) => `- ${issue.field}: ${issue.issue}`).join("\n");
}

export function validateWithSchema(
  schema: z.ZodType<Record<string, unknown>>,
  input: Record<string, unknown>
): ToolValidationResult {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return {
      ok: true,
      value: parsed.data as Record<string, DomainJsonValue>
    };
  }

  return {
    ok: false,
    issues: mapZodIssues(parsed.error.issues)
  };
}

export function createInvalidToolInputResult(
  toolName: string,
  issues: readonly ToolValidationIssue[],
  message = "Tool input validation failed."
): ToolExecutionResult {
  return failureResult(
    createToolResult({
      ok: false,
      code: "INVALID_TOOL_INPUT",
      message,
      validationErrors: [...issues]
    }),
    issues.length > 0
      ? `[${toolName}] invalid input\n${formatValidationErrors(issues)}`
      : `[${toolName}] invalid input`
  );
}

export function parseToolInput<T extends Record<string, unknown>>(
  toolName: string,
  schema: z.ZodType<T>,
  input: Record<string, unknown>
): { ok: true; data: T } | { ok: false; result: ToolExecutionResult } {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return {
      ok: true,
      data: parsed.data
    };
  }

  return {
    ok: false,
    result: createInvalidToolInputResult(toolName, mapZodIssues(parsed.error.issues))
  };
}

export function createToolResult<T extends DomainJsonValue>(
  value: ToolResult<T>
): ToolResult<T> {
  return value;
}

export function successResult<T extends DomainJsonValue>(
  value: ToolResult<T>,
  displayText: string,
  details?: ToolResultDetails
): ToolExecutionResult {
  return {
    state: "success",
    content: JSON.stringify(value, null, 2),
    displayText,
    result: value,
    ...(details ? { details } : {})
  };
}

export function failureResult(
  value: ToolResult,
  displayText: string,
  details?: ToolResultDetails
): ToolExecutionResult {
  return {
    state: "failed",
    content: JSON.stringify(value, null, 2),
    displayText,
    result: value,
    ...(details ? { details } : {}),
    error: value.message
  };
}
