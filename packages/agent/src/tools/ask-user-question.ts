import { z } from "zod";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const optionSchema = z.object({
  label: z.string().min(1),
  reply: z.string().min(1),
  description: z.string().min(1).optional(),
  is_recommended: z.boolean().optional()
});

const schema = z
  .object({
    question_text: z.string().min(1),
    options: z.array(optionSchema).max(4).optional(),
    allow_cancel: z.boolean().optional().default(true),
    context_note: z.string().min(1).optional()
  })
  .superRefine((input, ctx) => {
    const recommendedCount =
      input.options?.filter((option) => option.is_recommended).length ?? 0;
    if (recommendedCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At most one option can be marked as recommended.",
        path: ["options"]
      });
    }
  });

function mapOption(option: z.infer<typeof optionSchema>) {
  return {
    label: option.label,
    reply: option.reply,
    ...(option.description ? { description: option.description } : {}),
    ...(option.is_recommended ? { isRecommended: true } : {})
  };
}

function renderQuestionSummary(input: z.infer<typeof schema>): string {
  const lines = [
    "[ask_user_question] waiting for clarification",
    `- question: ${input.question_text}`
  ];

  for (const option of input.options ?? []) {
    const prefix = option.is_recommended
      ? "- recommended option: "
      : "- option: ";
    const optionLine =
      option.label === option.reply
        ? `${prefix}${option.label}`
        : `${prefix}${option.label} -> ${option.reply}`;
    lines.push(optionLine);
    if (option.description) {
      lines.push(`  note: ${option.description}`);
    }
  }

  if (input.context_note) {
    lines.push(`- context: ${input.context_note}`);
  }

  if (input.allow_cancel) {
    lines.push("- cancel option: 取消");
  }

  return lines.join("\n");
}

export function createAskUserQuestionTool(): RuntimeTool {
  return {
    name: "ask_user_question",
    description:
      "Pause the current run and ask the user one structured clarification question, optionally with quick-reply options.",
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        question_text: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              reply: { type: "string" },
              description: { type: "string" },
              is_recommended: { type: "boolean" }
            },
            required: ["label", "reply"],
            additionalProperties: false
          },
          maxItems: 4
        },
        allow_cancel: { type: "boolean" },
        context_note: { type: "string" }
      },
      required: ["question_text"],
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
          `[ask_user_question] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      await context.sessionManager.updateContext(context.sessionId, {
        status: "waiting_for_user_question",
        pendingPermissionRequest: null,
        pendingUserQuestionPayload: {
          questionText: parsed.data.question_text,
          options: (parsed.data.options ?? []).map(mapOption),
          allowCancel: parsed.data.allow_cancel,
          ...(parsed.data.context_note
            ? { contextNote: parsed.data.context_note }
            : {}),
          createdAt: new Date().toISOString()
        }
      });

      return successResult(
        createToolResult({
          ok: true,
          code: "USER_QUESTION_REQUESTED",
          message:
            "Stored a structured clarification question and paused the current run.",
          data: {
            question_text: parsed.data.question_text,
            options: (parsed.data.options ?? []).map((option) => ({
              label: option.label,
              reply: option.reply,
              ...(option.description
                ? { description: option.description }
                : {}),
              ...(option.is_recommended ? { is_recommended: true } : {})
            })),
            allow_cancel: parsed.data.allow_cancel,
            context_note: parsed.data.context_note ?? null
          }
        }),
        renderQuestionSummary(parsed.data)
      );
    }
  };
}
