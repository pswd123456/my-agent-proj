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

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z
  .object({
    action: z.literal("create"),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    date: z.string().regex(datePattern),
    start_time: z.string().regex(timePattern),
    end_time: z.string().regex(timePattern).optional(),
    duration_minutes: z.number().int().positive().optional(),
    source: z.enum(["user_confirmed", "agent_suggested_confirmed"])
  })
  .strict();

const editSchema = z
  .object({
    action: z.literal("edit"),
    routine_id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    date: z.string().regex(datePattern).optional(),
    start_time: z.string().regex(timePattern).optional(),
    end_time: z.string().regex(timePattern).optional(),
    duration_minutes: z.number().int().positive().optional()
  })
  .strict()
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

const deleteSchema = z
  .object({
    action: z.literal("delete"),
    routine_id: z.string().min(1),
    reason: z.string().optional()
  })
  .strict();

const schema = z.discriminatedUnion("action", [
  createSchema,
  editSchema,
  deleteSchema
]);

type ManageRoutineInput = z.infer<typeof schema>;

function buildCreateConflictInput(input: {
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

function buildEditConflictInput(
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

async function clearPendingScheduleState(
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  await context.sessionManager.updateContext(context.sessionId, {
    pendingPermissionRequest: null,
    pendingConfirmationPayload: null,
    pendingConflictSummary: null
  });
}

async function executeCreate(
  input: Extract<ManageRoutineInput, { action: "create" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  const conflicts = await context.routineRepository.findConflicts(
    buildCreateConflictInput({
      date: input.date,
      startTime: input.start_time,
      endTime: input.end_time,
      durationMinutes: input.duration_minutes
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
      `[manage_routine] conflict detected\n- action: create\n${formatConflictLines(
        conflicts
      )}`
    );
  }

  const createInput = {
    name: input.name,
    description: input.description ?? null,
    date: input.date,
    startTime: input.start_time,
    source: input.source
  } as {
    name: string;
    description: string | null;
    date: string;
    startTime: string;
    endTime?: string;
    durationMinutes?: number;
    source: "user_confirmed" | "agent_suggested_confirmed";
  };

  if (typeof input.end_time === "string") {
    createInput.endTime = input.end_time;
  }
  if (typeof input.duration_minutes === "number") {
    createInput.durationMinutes = input.duration_minutes;
  }

  const routine = await context.routineRepository.create(createInput);

  await clearPendingScheduleState(context);

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
    `[manage_routine] success\n- action: create\n${formatRoutineLine(routine)}`
  );
}

async function executeEdit(
  input: Extract<ManageRoutineInput, { action: "edit" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  const existing = await context.routineRepository.getById(input.routine_id);
  if (!existing || existing.status !== "active") {
    return failureResult(
      createToolResult({
        ok: false,
        code: "ROUTINE_NOT_FOUND",
        message: "Routine not found."
      }),
      `[manage_routine] failed\n- action: edit\n- routine not found: ${input.routine_id}`
    );
  }

  const conflicts = await context.routineRepository.findConflicts(
    buildEditConflictInput(
      mergeRoutineTimingForUpdate(existing, {
        ...buildTimingPatch({
          date: input.date,
          startTime: input.start_time,
          endTime: input.end_time,
          durationMinutes: input.duration_minutes
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
      `[manage_routine] conflict detected\n- action: edit\n${formatConflictLines(
        conflicts
      )}`
    );
  }

  const routine = await context.routineRepository.update(
    existing.id,
    buildUpdateInput({
      name: input.name,
      description: input.description,
      date: input.date,
      startTime: input.start_time,
      endTime: input.end_time,
      durationMinutes: input.duration_minutes
    })
  );

  if (!routine) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "ROUTINE_UPDATE_FAILED",
        message: "Routine update failed."
      }),
      `[manage_routine] failed\n- action: edit\n- could not update: ${existing.id}`
    );
  }

  await clearPendingScheduleState(context);

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
    `[manage_routine] success\n- action: edit\n${formatRoutineLine(routine)}`
  );
}

async function executeDelete(
  input: Extract<ManageRoutineInput, { action: "delete" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  const existing = await context.routineRepository.getById(input.routine_id);
  if (!existing || existing.status !== "active") {
    return failureResult(
      createToolResult({
        ok: false,
        code: "ROUTINE_NOT_FOUND",
        message: "Routine not found."
      }),
      `[manage_routine] failed\n- action: delete\n- routine not found: ${input.routine_id}`
    );
  }

  const deleted = await context.routineRepository.remove(input.routine_id);
  if (!deleted) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "ROUTINE_DELETE_FAILED",
        message: "Routine delete failed."
      }),
      `[manage_routine] failed\n- action: delete\n- could not delete: ${input.routine_id}`
    );
  }

  await clearPendingScheduleState(context);

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
    `[manage_routine] success\n- action: delete\n- deleted: ${deleted.date} ${deleted.startTime}-${deleted.endTime} ${deleted.name}`
  );
}

export function createManageRoutineTool(): RuntimeTool {
  return {
    name: "manage_routine",
    description: buildToolDescription({
      usageScenarios: [
        "Create, edit, or delete routines after schedule details are confirmed.",
        "Apply routine mutations through one schedule management tool."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "action",
          type: '"create" | "edit" | "delete"',
          required: true,
          description: "Choose the routine mutation."
        }),
        "Use action=create with name, date, start_time, source, and optional end_time or duration_minutes.",
        "Use action=edit with routine_id and at least one editable field.",
        "Use action=delete with routine_id and optional reason."
      ],
      constraints: [
        "The requested time range must be valid and conflict-free.",
        "Conflicting routine creates or edits are rejected instead of silently applied.",
        "Edit and delete targets must exist and be active."
      ],
      examples: [
        '{"action":"create","name":"Study algorithms","date":"2026-05-03","start_time":"09:00","end_time":"10:30","source":"user_confirmed"}',
        '{"action":"edit","routine_id":"routine_123","start_time":"10:00","end_time":"11:00"}',
        '{"action":"delete","routine_id":"routine_123","reason":"User cancelled this plan"}'
      ]
    }),
    family: "schedule",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "create" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            date: { type: "string", format: "date" },
            start_time: { type: "string" },
            end_time: { type: "string" },
            duration_minutes: { type: "number" },
            source: {
              type: "string",
              enum: ["user_confirmed", "agent_suggested_confirmed"]
            }
          },
          required: ["action", "name", "date", "start_time", "source"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "edit" },
            routine_id: { type: "string" },
            name: { type: "string" },
            description: { type: ["string", "null"] },
            date: { type: "string", format: "date" },
            start_time: { type: "string" },
            end_time: { type: "string" },
            duration_minutes: { type: "number" }
          },
          required: ["action", "routine_id"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "delete" },
            routine_id: { type: "string" },
            reason: { type: "string" }
          },
          required: ["action", "routine_id"],
          additionalProperties: false
        }
      ]
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("manage_routine", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      if (parsed.data.action === "create") {
        return executeCreate(parsed.data, context);
      }
      if (parsed.data.action === "edit") {
        return executeEdit(parsed.data, context);
      }
      return executeDelete(parsed.data, context);
    }
  };
}
