import { z } from "zod";

import {
  createConfirmationToolResultData,
  createPendingConfirmationPayload,
  type DomainJsonValue
} from "@ai-app-template/domain";

import type { RuntimeTool } from "./runtime-tool.js";
import { formatConflictLines } from "./routine-format.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { buildToolDescription } from "./tool-description.js";

const createRoutineOverlapSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end_time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  duration_minutes: z.number().int().positive().optional()
});

function toCreateRoutineConflictInput(value: Record<string, DomainJsonValue>): {
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
} | null {
  const parsed = createRoutineOverlapSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const next = {
    date: parsed.data.date,
    startTime: parsed.data.start_time
  } as {
    date: string;
    startTime: string;
    endTime?: string;
    durationMinutes?: number;
  };

  if (typeof parsed.data.end_time === "string") {
    next.endTime = parsed.data.end_time;
  }

  if (typeof parsed.data.duration_minutes === "number") {
    next.durationMinutes = parsed.data.duration_minutes;
  }

  return next;
}

const schema = z.object({
  summary_text: z.string().min(1),
  proposed_items: z
    .array(
      z.object({
        preview_text: z.string().min(1),
        tool_name: z.string().optional(),
        tool_input: z.record(z.string(), z.any()).optional()
      })
    )
    .min(1),
  context_note: z.string().optional(),
  conflict_items: z
    .array(
      z.object({
        routine_id: z.string().min(1),
        preview_text: z.string().min(1)
      })
    )
    .optional()
});

export function createAskForConfirmationTool(): RuntimeTool {
  return {
    name: "ask_for_confirmation",
    description: buildToolDescription({
      usageScenarios: [
        "Pause and ask the user to confirm a risky or ambiguous schedule action.",
        "Present conflicting routine candidates before proceeding."
      ],
      usageInstructions: [
        "Provide summary_text to explain what needs confirmation.",
        "Provide proposed_items as the actions the user may confirm.",
        "Optionally include conflict_items to show conflicting routines and context_note for extra explanation."
      ],
      constraints: [
        "This tool is for structured user confirmation, not for silently resolving schedule conflicts.",
        "Routine creation that still overlaps an existing routine is rejected instead of entering confirmation."
      ],
      examples: [
        '{"summary_text":"The new routine overlaps an existing one.","proposed_items":[{"preview_text":"Create 09:00-10:00 routine","tool_name":"create_routine","tool_input":{"name":"Study","date":"2026-05-03","start_time":"09:00","end_time":"10:00","source":"user_confirmed"}}],"conflict_items":[{"routine_id":"routine_1","preview_text":"Existing routine 09:30-10:30"}]}'
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
        summary_text: { type: "string" },
        proposed_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              preview_text: { type: "string" },
              tool_name: { type: "string" },
              tool_input: { type: "object" }
            }
          }
        },
        context_note: { type: "string" },
        conflict_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              routine_id: { type: "string" },
              preview_text: { type: "string" }
            }
          }
        }
      },
      required: ["summary_text", "proposed_items"],
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
          `[ask_for_confirmation] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      for (const item of parsed.data.proposed_items) {
        if (item.tool_name !== "create_routine" || !item.tool_input) {
          continue;
        }

        const createInput = toCreateRoutineConflictInput(
          item.tool_input as Record<string, DomainJsonValue>
        );
        if (!createInput) {
          continue;
        }

        const conflicts = await context.routineRepository.findConflicts(
          context.userId,
          createInput
        );
        if (conflicts.length > 0) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "CREATE_ROUTINE_OVERLAP_NOT_CONFIRMABLE",
              message:
                "Creating a routine with overlap must fail instead of entering confirmation.",
              data: {
                conflicts: conflicts.map((conflict) => ({
                  routine_id: conflict.routine.id,
                  preview_text: conflict.previewText
                }))
              }
            }),
            [
              "[ask_for_confirmation] overlap not confirmable",
              formatConflictLines(conflicts),
              "- action needed: choose another time or edit/delete the existing routine first"
            ].join("\n")
          );
        }
      }

      const payload = createPendingConfirmationPayload(parsed.data);

      await context.sessionManager.updateContext(context.sessionId, {
        status: "waiting_for_conflict_confirmation",
        pendingPermissionRequest: null,
        pendingConfirmationPayload: payload,
        pendingConflictSummary: parsed.data.summary_text
      });

      const lines = [
        "[ask_for_confirmation] conflict detected",
        ...parsed.data.proposed_items.map(
          (item) => `- proposed: ${item.preview_text}`
        ),
        ...(parsed.data.conflict_items ?? []).map(
          (item) => `- existing: ${item.preview_text}`
        ),
        "- action needed: confirm overwrite or provide another time"
      ];

      return successResult(
        createToolResult({
          ok: true,
          code: "CONFIRMATION_REQUIRED",
          message: "Confirmation is required before proceeding.",
          data: createConfirmationToolResultData(payload)
        }),
        lines.join("\n")
      );
    }
  };
}
