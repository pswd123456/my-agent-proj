import type { DomainJsonValue } from "@ai-app-template/domain";
import { z } from "zod";

import type { RuntimeTool } from "./runtime-tool.js";
import { formatConflictLines, formatRoutineLine } from "./routine-format.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";

function buildConflictInput(input: {
  date: string;
  startTime: string;
  endTime: string | undefined;
  durationMinutes: number | undefined;
}): {
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
} {
  const next = {
    date: input.date,
    startTime: input.startTime
  } as {
    date: string;
    startTime: string;
    endTime?: string;
    durationMinutes?: number;
  };

  if (typeof input.endTime === "string") {
    next.endTime = input.endTime;
  }
  if (typeof input.durationMinutes === "number") {
    next.durationMinutes = input.durationMinutes;
  }
  return next;
}

const schema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  duration_minutes: z.number().int().positive().optional(),
  source: z.enum(["user_confirmed", "agent_suggested_confirmed"])
});

export function createCreateRoutineTool(): RuntimeTool {
  return {
    name: "create_routine",
    description: "Create a routine when the time range is valid and conflict-free.",
    family: "schedule",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        date: { type: "string", format: "date" },
        start_time: { type: "string" },
        end_time: { type: "string" },
        duration_minutes: { type: "number" },
        source: {
          type: "string",
          enum: ["user_confirmed", "agent_suggested_confirmed"]
        }
      },
      required: ["name", "date", "start_time", "source"],
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("create_routine", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      const conflicts = await context.routineRepository.findConflicts(
        context.userId,
        buildConflictInput({
          date: parsed.data.date,
          startTime: parsed.data.start_time,
          endTime: parsed.data.end_time,
          durationMinutes: parsed.data.duration_minutes
        })
      );

      if (conflicts.length > 0) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "ROUTINE_CONFLICT",
            message: "Routine conflicts with an existing schedule.",
            data: {
              conflicts: conflicts.map((conflict) => ({
                routine_id: conflict.routine.id,
                preview_text: conflict.previewText
              }))
            } as DomainJsonValue
          }),
          `[create_routine] conflict detected\n${formatConflictLines(conflicts)}`
        );
      }

      const createInput = {
        userId: context.userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        date: parsed.data.date,
        startTime: parsed.data.start_time,
        source: parsed.data.source
      } as {
        userId: string;
        name: string;
        description: string | null;
        date: string;
        startTime: string;
        endTime?: string;
        durationMinutes?: number;
        source: "user_confirmed" | "agent_suggested_confirmed";
      };

      if (typeof parsed.data.end_time === "string") {
        createInput.endTime = parsed.data.end_time;
      }
      if (typeof parsed.data.duration_minutes === "number") {
        createInput.durationMinutes = parsed.data.duration_minutes;
      }

      const routine = await context.routineRepository.create(createInput);

      await context.sessionManager.updateContext(context.sessionId, {
        pendingPermissionRequest: null,
        pendingConfirmationPayload: null,
        pendingConflictSummary: null
      });

      return successResult(
        createToolResult({
          ok: true,
          code: "ROUTINE_CREATED",
          message: "Routine created successfully.",
          data: {
            routine_id: routine.id,
            date: routine.date,
            start_time: routine.startTime,
            end_time: routine.endTime,
            name: routine.name
          } as DomainJsonValue
        }),
        `[create_routine] success\n${formatRoutineLine(routine)}`
      );
    }
  };
}
