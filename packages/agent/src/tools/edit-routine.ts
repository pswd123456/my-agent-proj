import {
  mergeRoutineTimingForUpdate,
  type DomainJsonValue
} from "@ai-app-template/domain";
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
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

function buildUpdateInput(input: {
  name: string | undefined;
  description: string | null | undefined;
  date: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  durationMinutes: number | undefined;
}): {
  name?: string;
  description?: string | null;
  date?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
} {
  const next = {} as {
    name?: string;
    description?: string | null;
    date?: string;
    startTime?: string;
    endTime?: string;
    durationMinutes?: number;
  };

  if (typeof input.name === "string") {
    next.name = input.name;
  }
  if (typeof input.description !== "undefined") {
    next.description = input.description;
  }
  if (typeof input.date === "string") {
    next.date = input.date;
  }
  if (typeof input.startTime === "string") {
    next.startTime = input.startTime;
  }
  if (typeof input.endTime === "string") {
    next.endTime = input.endTime;
  }
  if (typeof input.durationMinutes === "number") {
    next.durationMinutes = input.durationMinutes;
  }

  return next;
}

function buildTimingPatch(input: {
  date: string | undefined;
  startTime: string | undefined;
  endTime: string | undefined;
  durationMinutes: number | undefined;
}): {
  date?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
} {
  const next = {} as {
    date?: string;
    startTime?: string;
    endTime?: string;
    durationMinutes?: number;
  };

  if (typeof input.date === "string") {
    next.date = input.date;
  }
  if (typeof input.startTime === "string") {
    next.startTime = input.startTime;
  }
  if (typeof input.endTime === "string") {
    next.endTime = input.endTime;
  }
  if (typeof input.durationMinutes === "number") {
    next.durationMinutes = input.durationMinutes;
  }

  return next;
}

function buildConflictInput(
  input: {
    date: string;
    startTime: string;
    endTime?: string;
    durationMinutes?: number;
  },
  excludeRoutineId: string | undefined
): {
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  excludeRoutineId?: string;
} {
  const next = { ...input } as {
    date: string;
    startTime: string;
    endTime?: string;
    durationMinutes?: number;
    excludeRoutineId?: string;
  };

  if (typeof excludeRoutineId === "string") {
    next.excludeRoutineId = excludeRoutineId;
  }

  return next;
}

const schema = z
  .object({
    routine_id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    start_time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    end_time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    duration_minutes: z.number().int().positive().optional()
  })
  .superRefine((value, ctx) => {
    if (
      typeof value.name === "undefined" &&
      typeof value.description === "undefined" &&
      typeof value.date === "undefined" &&
      typeof value.start_time === "undefined" &&
      typeof value.end_time === "undefined" &&
      typeof value.duration_minutes === "undefined"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["routine_id"],
        message: "At least one editable field is required."
      });
    }
  });

export function createEditRoutineTool(): RuntimeTool {
  return {
    name: "edit_routine",
    description: buildToolDescription({
      usageScenarios: [
        "Update an existing active routine."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "routine_id",
          type: "string",
          required: true,
          description: "Existing active routine id to update."
        }),
        "Provide one or more editable fields such as name, description, date, start_time, end_time, or duration_minutes."
      ],
      constraints: [
        "At least one editable field is required in addition to routine_id.",
        "The updated time range must still be valid and conflict-free.",
        "The target routine must exist and be active."
      ],
      examples: [
        '{"routine_id":"routine_123","start_time":"10:00","end_time":"11:00"}'
      ]
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
        name: { type: "string" },
        description: { type: "string" },
        date: { type: "string", format: "date" },
        start_time: { type: "string" },
        end_time: { type: "string" },
        duration_minutes: { type: "number" }
      },
      required: ["routine_id"],
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("edit_routine", schema, input);
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
          `[edit_routine] failed\n- routine not found: ${parsed.data.routine_id}`
        );
      }

      const conflicts = await context.routineRepository.findConflicts(
        context.userId,
        buildConflictInput(
          mergeRoutineTimingForUpdate(existing, {
            ...buildTimingPatch({
              date: parsed.data.date,
              startTime: parsed.data.start_time,
              endTime: parsed.data.end_time,
              durationMinutes: parsed.data.duration_minutes
            })
          }),
          existing.id
        )
      );

      if (conflicts.length > 0) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "ROUTINE_CONFLICT",
            message: "Updated routine conflicts with an existing schedule.",
            data: {
              conflicts: conflicts.map((conflict) => ({
                routine_id: conflict.routine.id,
                preview_text: conflict.previewText
              }))
            } as DomainJsonValue
          }),
          `[edit_routine] conflict detected\n${formatConflictLines(conflicts)}`
        );
      }

      const routine = await context.routineRepository.update(
        context.userId,
        existing.id,
        buildUpdateInput({
          name: parsed.data.name,
          description: parsed.data.description,
          date: parsed.data.date,
          startTime: parsed.data.start_time,
          endTime: parsed.data.end_time,
          durationMinutes: parsed.data.duration_minutes
        })
      );

      if (!routine) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "ROUTINE_UPDATE_FAILED",
            message: "Routine update failed."
          }),
          `[edit_routine] failed\n- could not update: ${existing.id}`
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
          code: "ROUTINE_UPDATED",
          message: "Routine updated successfully.",
          data: {
            routine_id: routine.id,
            date: routine.date,
            start_time: routine.startTime,
            end_time: routine.endTime,
            name: routine.name
          } as DomainJsonValue
        }),
        `[edit_routine] success\n${formatRoutineLine(routine)}`
      );
    }
  };
}
