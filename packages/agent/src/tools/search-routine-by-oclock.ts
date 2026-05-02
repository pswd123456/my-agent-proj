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

function buildSearchInput(input: {
  date: string;
  time: string | undefined;
  timeRange:
    | {
        start: string;
        end: string;
      }
    | undefined;
}): {
  date: string;
  time?: string;
  timeRange?: {
    start: string;
    end: string;
  };
} {
  const next = {
    date: input.date
  } as {
    date: string;
    time?: string;
    timeRange?: {
      start: string;
      end: string;
    };
  };

  if (typeof input.time === "string") {
    next.time = input.time;
  }
  if (input.timeRange) {
    next.timeRange = input.timeRange;
  }

  return next;
}

const schema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    time_range: z
      .object({
        start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    if (typeof value.time === "undefined" && typeof value.time_range === "undefined") {
      ctx.addIssue({
        code: "custom",
        path: ["time"],
        message: "Provide time or time_range."
      });
    }
  });

export function createSearchRoutineByOclockTool(): RuntimeTool {
  return {
    name: "search_routine_by_oclock",
    description: "Search routines around a specific time or time range.",
    family: "schedule",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", format: "date" },
        time: { type: "string" },
        time_range: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" }
          }
        }
      },
      required: ["date"],
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("search_routine_by_oclock", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      const routines = await context.routineRepository.searchByTime(
        context.userId,
        buildSearchInput({
          date: parsed.data.date,
          time: parsed.data.time,
          timeRange: parsed.data.time_range
        })
      );

      return successResult(
        createToolResult({
          ok: true,
          code: "ROUTINE_SEARCH_OK",
          message: "Routine search completed.",
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
          ? `[search_routine_by_oclock] success\n${formatRoutineLines(routines)}`
          : "[search_routine_by_oclock] success\n- no routines found"
      );
    }
  };
}
