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
  week_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export function createListRoutineByWeekTool(): RuntimeTool {
  return {
    name: "list_routine_by_week",
    description: "List routines from the provided week start date over 7 days.",
    isReadOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        week_start_date: { type: "string", format: "date" }
      },
      required: ["week_start_date"],
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
          `[list_routine_by_week] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const routines = await context.routineRepository.listByWeek(
        context.userId,
        parsed.data.week_start_date
      );

      return successResult(
        createToolResult({
          ok: true,
          code: "ROUTINE_LIST_OK",
          message: "Weekly routine list completed.",
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
          ? `[list_routine_by_week] success\n${formatRoutineLines(routines)}`
          : "[list_routine_by_week] success\n- no routines found"
      );
    }
  };
}
