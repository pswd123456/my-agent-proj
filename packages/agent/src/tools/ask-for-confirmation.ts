import { z } from "zod";

import type { DomainJsonValue } from "@ai-app-template/domain";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

function toPendingConfirmationPayload(
  input: z.infer<typeof schema>
): {
  summaryText: string;
    proposedItems: Array<{
      previewText: string;
      toolName?: string;
      toolInput?: Record<string, DomainJsonValue>;
  }>;
  contextNote?: string;
  conflictItems?: Array<{
    routineId: string;
    previewText: string;
  }>;
  createdAt: string;
} {
  return {
    summaryText: input.summary_text,
    proposedItems: input.proposed_items.map((item) => {
      const next = {
        previewText: item.preview_text
      } as {
        previewText: string;
        toolName?: string;
        toolInput?: Record<string, DomainJsonValue>;
      };
      if (typeof item.tool_name === "string") {
        next.toolName = item.tool_name;
      }
      if (item.tool_input) {
        next.toolInput = item.tool_input as Record<string, DomainJsonValue>;
      }
      return next;
    }),
    ...(typeof input.context_note === "string"
      ? { contextNote: input.context_note }
      : {}),
    ...(input.conflict_items
      ? {
          conflictItems: input.conflict_items.map((item) => ({
            routineId: item.routine_id,
            previewText: item.preview_text
          }))
        }
      : {}),
    createdAt: new Date().toISOString()
  };
}

function toConfirmationData(input: z.infer<typeof schema>) {
  return {
    summary_text: input.summary_text,
    proposed_items: input.proposed_items.map((item) => ({
      preview_text: item.preview_text,
      ...(typeof item.tool_name === "string" ? { tool_name: item.tool_name } : {}),
      ...(item.tool_input ? { tool_input: item.tool_input } : {})
    })),
    conflict_items: (input.conflict_items ?? []).map((item) => ({
      routine_id: item.routine_id,
      preview_text: item.preview_text
    })),
    context_note: input.context_note ?? null
  };
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
    description:
      "Store and render a confirmation request when there is conflict, overwrite risk, or ambiguity.",
    isReadOnly: false,
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

      const payload = toPendingConfirmationPayload(parsed.data);

      await context.sessionManager.updateContext(context.sessionId, {
        status: "waiting_for_conflict_confirmation",
        pendingConfirmationPayload: payload,
        pendingConflictSummary: parsed.data.summary_text
      });

      const lines = [
        "[ask_for_confirmation] conflict detected",
        ...parsed.data.proposed_items.map((item) => `- proposed: ${item.preview_text}`),
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
          data: toConfirmationData(parsed.data)
        }),
        lines.join("\n")
      );
    }
  };
}
