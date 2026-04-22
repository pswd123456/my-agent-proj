import { z } from "zod";

import type { RuntimeTool } from "./runtime-tool.js";
import { formatRoutineLines } from "./routine-format.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z.object({
  date_range: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
});

export function createListRoutineByDateTool(): RuntimeTool {
  return {
    name: "list_routine_by_date",
    description: "List routines by a date or date range.",
    family: "schedule",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        date_range: {
          type: "object",
          properties: {
            start: { type: "string", format: "date" },
            end: { type: "string", format: "date" }
          }
        }
      },
      required: ["date_range"],
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
          `[list_routine_by_date] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const routines = await context.routineRepository.listByDateRange(
        context.userId,
        parsed.data.date_range.start,
        parsed.data.date_range.end
      );

      return successResult(
        createToolResult({
          ok: true,
          code: "ROUTINE_LIST_OK",
          message: "Date range routine list completed.",
          data: {
            items: routines.map((routine) => ({
              routine_id: routine.id,
              date: routine.date,
              start_time: routine.startTime,
              end_time: routine.endTime,
              name: routine.name
            }))
          }
        }),
        routines.length > 0
          ? `[list_routine_by_date] success\n${formatRoutineLines(routines)}`
          : "[list_routine_by_date] success\n- no routines found"
      );
    }
  };
}
