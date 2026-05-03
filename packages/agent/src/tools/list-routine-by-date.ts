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
  date_range: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
});

export function createListRoutineByDateTool(): RuntimeTool {
  return {
    name: "list_routine_by_date",
    description: buildToolDescription({
      usageScenarios: [
        "List routines for a specific date range.",
        "Inspect planned work across a known period."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "date_range.start",
          type: "string",
          required: true,
          description: "Inclusive YYYY-MM-DD start date."
        }),
        describeObjectProperty({
          name: "date_range.end",
          type: "string",
          required: true,
          description: "Inclusive YYYY-MM-DD end date."
        })
      ],
      constraints: [
        "Dates must use YYYY-MM-DD format.",
        "This is a read-only listing tool and does not modify schedule state."
      ],
      examples: ['{"date_range":{"start":"2026-05-01","end":"2026-05-07"}}']
    }),
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
      const parsed = parseToolInput("list_routine_by_date", schema, input);
      if (!parsed.ok) {
        return parsed.result;
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
