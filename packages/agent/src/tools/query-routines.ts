import { z } from "zod";

import type { RoutineRecord } from "@ai-app-template/domain";

import type { RuntimeTool } from "./runtime-tool.js";
import { formatRoutineLines } from "./routine-format.js";
import {
  createToolResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const byTimeSchema = z
  .object({
    action: z.literal("by_time"),
    date: z.string().regex(datePattern),
    time: z.string().regex(timePattern).optional(),
    time_range: z
      .object({
        start: z.string().regex(timePattern),
        end: z.string().regex(timePattern)
      })
      .optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      typeof value.time === "undefined" &&
      typeof value.time_range === "undefined"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["time"],
        message: "Provide time or time_range."
      });
    }
  });

const byWeekSchema = z
  .object({
    action: z.literal("by_week"),
    week_start_date: z.string().regex(datePattern)
  })
  .strict();

const byDateRangeSchema = z
  .object({
    action: z.literal("by_date_range"),
    date_range: z.object({
      start: z.string().regex(datePattern),
      end: z.string().regex(datePattern)
    })
  })
  .strict();

const schema = z.discriminatedUnion("action", [
  byTimeSchema,
  byWeekSchema,
  byDateRangeSchema
]);

type QueryRoutinesInput = z.infer<typeof schema>;

function buildSearchInput(
  input: Extract<QueryRoutinesInput, { action: "by_time" }>
): {
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
  if (input.time_range) {
    next.timeRange = input.time_range;
  }

  return next;
}

function routineItems(routines: RoutineRecord[]) {
  return routines.map((routine) => ({
    routine_id: routine.id,
    date: routine.date,
    start_time: routine.startTime,
    end_time: routine.endTime,
    name: routine.name
  }));
}

function routineDisplay(
  action: QueryRoutinesInput["action"],
  routines: RoutineRecord[]
): string {
  return routines.length > 0
    ? `[query_routines] success\n- action: ${action}\n${formatRoutineLines(routines)}`
    : `[query_routines] success\n- action: ${action}\n- no routines found`;
}

export function createQueryRoutinesTool(): RuntimeTool {
  return {
    name: "query_routines",
    description: buildToolDescription({
      usageScenarios: [
        "List routines by week or date range.",
        "Find routines around a specific time or time range on a date."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "action",
          type: '"by_time" | "by_week" | "by_date_range"',
          required: true,
          description: "Choose the routine query mode."
        }),
        "Use action=by_time with date plus time or time_range.",
        "Use action=by_week with week_start_date for a 7-day listing.",
        "Use action=by_date_range with date_range.start and date_range.end for an inclusive range."
      ],
      constraints: [
        "Dates must use YYYY-MM-DD format.",
        "Times must use HH:mm format.",
        "This is a read-only schedule lookup tool."
      ],
      examples: [
        '{"action":"by_time","date":"2026-05-03","time":"09:30"}',
        '{"action":"by_week","week_start_date":"2026-05-04"}',
        '{"action":"by_date_range","date_range":{"start":"2026-05-01","end":"2026-05-07"}}'
      ]
    }),
    family: "schedule",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "by_time" },
            date: { type: "string", format: "date" },
            time: { type: "string" },
            time_range: {
              type: "object",
              properties: {
                start: { type: "string" },
                end: { type: "string" }
              },
              required: ["start", "end"],
              additionalProperties: false
            }
          },
          required: ["action", "date"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "by_week" },
            week_start_date: { type: "string", format: "date" }
          },
          required: ["action", "week_start_date"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "by_date_range" },
            date_range: {
              type: "object",
              properties: {
                start: { type: "string", format: "date" },
                end: { type: "string", format: "date" }
              },
              required: ["start", "end"],
              additionalProperties: false
            }
          },
          required: ["action", "date_range"],
          additionalProperties: false
        }
      ]
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("query_routines", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      if (parsed.data.action === "by_time") {
        const routines = await context.routineRepository.searchByTime(
          context.userId,
          buildSearchInput(parsed.data)
        );
        return successResult(
          createToolResult({
            ok: true,
            code: "ROUTINE_SEARCH_OK",
            message: "Routine search completed.",
            data: {
              items: routineItems(routines)
            }
          }),
          routineDisplay(parsed.data.action, routines)
        );
      }

      if (parsed.data.action === "by_week") {
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
              items: routineItems(routines)
            }
          }),
          routineDisplay(parsed.data.action, routines)
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
            items: routineItems(routines)
          }
        }),
        routineDisplay(parsed.data.action, routines)
      );
    }
  };
}
