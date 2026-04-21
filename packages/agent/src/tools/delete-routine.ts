import { z } from "zod";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z.object({
  routine_id: z.string().min(1),
  reason: z.string().optional()
});

export function createDeleteRoutineTool(): RuntimeTool {
  return {
    name: "delete_routine",
    description: "Delete an existing routine after the target is identified clearly.",
    isReadOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        routine_id: { type: "string" },
        reason: { type: "string" }
      },
      required: ["routine_id"],
      additionalProperties: false
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
          `[delete_routine] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const existing = await context.routineRepository.getById(
        context.userId,
        parsed.data.routine_id
      );
      if (!existing || existing.status !== "active") {
        return failureResult(
          createToolResult({
            ok: false,
            code: "ROUTINE_NOT_FOUND",
            message: "Routine not found."
          }),
          `[delete_routine] failed\n- routine not found: ${parsed.data.routine_id}`
        );
      }

      const deleted = await context.routineRepository.remove(
        context.userId,
        parsed.data.routine_id
      );
      if (!deleted) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "ROUTINE_DELETE_FAILED",
            message: "Routine delete failed."
          }),
          `[delete_routine] failed\n- could not delete: ${parsed.data.routine_id}`
        );
      }

      await context.sessionManager.updateContext(context.sessionId, {
        status: "completed",
        pendingConfirmationPayload: null,
        pendingConflictSummary: null
      });

      return successResult(
        createToolResult({
          ok: true,
          code: "ROUTINE_DELETED",
          message: "Routine deleted successfully.",
          data: {
            routine_id: deleted.id,
            name: deleted.name
          }
        }),
        `[delete_routine] success\n- deleted: ${deleted.date} ${deleted.startTime}-${deleted.endTime} ${deleted.name}`
      );
    }
  };
}
