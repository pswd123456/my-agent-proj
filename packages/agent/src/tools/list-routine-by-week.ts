import { z } from "zod";

import type { RuntimeTool } from "./runtime-tool.js";
import { formatRoutineLines } from "./routine-format.js";
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
  week_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export function createListRoutineByWeekTool(): RuntimeTool {
  return {
    name: "list_routine_by_week",
    description: buildToolDescription({
      usageScenarios: [
        "List routines for a whole week from a known week start date."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "week_start_date",
          type: "string",
          required: true,
          description: "YYYY-MM-DD date representing the start of the week window."
        })
      ],
      constraints: [
        "Dates must use YYYY-MM-DD format.",
        "The tool returns a 7-day listing starting from week_start_date."
      ],
      examples: ['{"week_start_date":"2026-05-04"}']
    }),
    family: "schedule",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
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
      const parsed = parseToolInput("list_routine_by_week", schema, input);
      if (!parsed.ok) {
        return parsed.result;
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
