import type { DomainJsonValue, ToolResult, ToolValidationIssue } from "@ai-app-template/domain";

import { z } from "zod";

import type {
  ToolExecutionResult,
  ToolValidationResult
} from "./runtime-tool.js";

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

  const issues: ToolValidationIssue[] = parsed.error.issues.map((issue) => ({
    field: issue.path.join(".") || "input",
    issue: issue.message
  }));

  return {
    ok: false,
    issues
  };
}

export function createToolResult<T extends DomainJsonValue>(
  value: ToolResult<T>
): ToolResult<T> {
  return value;
}

export function successResult<T extends DomainJsonValue>(
  value: ToolResult<T>,
  displayText: string
): ToolExecutionResult {
  return {
    state: "success",
    content: JSON.stringify(value, null, 2),
    displayText,
    result: value
  };
}

export function failureResult(
  value: ToolResult,
  displayText: string
): ToolExecutionResult {
  return {
    state: "failed",
    content: JSON.stringify(value, null, 2),
    displayText,
    result: value,
    error: value.message
  };
}
