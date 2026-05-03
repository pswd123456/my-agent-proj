import { z } from "zod";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

const schema = z.object({
  routine_id: z.string().min(1),
  reason: z.string().optional()
});

export function createDeleteRoutineTool(): RuntimeTool {
  return {
    name: "delete_routine",
    description: buildToolDescription({
      usageScenarios: [
        "Delete an existing active routine after the target is identified."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "routine_id",
          type: "string",
          required: true,
          description: "Existing active routine id to delete."
        }),
        describeObjectProperty({
          name: "reason",
          type: "string",
          description: "Optional reason for the deletion."
        })
      ],
      constraints: [
        "The target routine must exist and be active.",
        "Use a concrete routine_id rather than a fuzzy description."
      ],
      examples: ['{"routine_id":"routine_123","reason":"User cancelled this plan"}']
    }),
    family: "schedule",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
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
      const parsed = parseToolInput("delete_routine", schema, input);
      if (!parsed.ok) {
        return parsed.result;
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
        pendingPermissionRequest: null,
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
