import { z } from "zod";

import {
  createPendingUserQuestionPayload,
  createUserQuestionToolResultData,
  type PendingUserQuestionPayload
} from "@ai-app-template/domain";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { buildToolDescription } from "./tool-description.js";

const optionSchema = z.object({
  label: z.string().min(1),
  reply: z.string().min(1),
  description: z.string().min(1).optional(),
  is_recommended: z.boolean().optional()
});

const questionSchema = z
  .object({
    question_text: z.string().min(1),
    options: z.array(optionSchema).max(5).optional(),
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

const schema = z
  .object({
    question_text: z.string().min(1).optional(),
    options: z.array(optionSchema).max(5).optional(),
    allow_cancel: z.boolean().optional().default(true),
    context_note: z.string().min(1).optional(),
    questions: z.array(questionSchema).min(1).max(4).optional()
  })
  .superRefine((input, ctx) => {
    const hasSingleQuestion = typeof input.question_text === "string";
    const hasQuestionBatch = Array.isArray(input.questions);

    if (hasSingleQuestion === hasQuestionBatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either question_text for one question or questions for a multi-question batch.",
        path: ["question_text"]
      });
      return;
    }

    if (hasQuestionBatch) {
      const hasLegacyFields =
        typeof input.options !== "undefined" ||
        typeof input.context_note === "string";
      if (hasLegacyFields) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "When questions is provided, move options and context_note into each question item.",
          path: ["questions"]
        });
      }
      return;
    }

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

type ParsedQuestionInput = z.infer<typeof questionSchema>;
type ParsedInput = z.infer<typeof schema>;

function normalizeQuestions(input: ParsedInput): ParsedQuestionInput[] {
  if (Array.isArray(input.questions)) {
    return input.questions;
  }

  return [
    {
      question_text: input.question_text ?? "",
      ...(input.options ? { options: input.options } : {}),
      allow_cancel: input.allow_cancel,
      ...(input.context_note ? { context_note: input.context_note } : {})
    }
  ];
}

function renderQuestionSummary(payload: PendingUserQuestionPayload): string {
  const lines = ["[ask_user_question] waiting for clarification"];

  for (const [index, question] of payload.questions.entries()) {
    lines.push(`- question ${index + 1}: ${question.questionText}`);

    for (const option of question.options) {
      const prefix = option.isRecommended
        ? "  - recommended option: "
        : "  - option: ";
      const optionLine =
        option.label === option.reply
          ? `${prefix}${option.label}`
          : `${prefix}${option.label} -> ${option.reply}`;
      lines.push(optionLine);
      if (option.description) {
        lines.push(`    note: ${option.description}`);
      }
    }

    if (question.allowCancel !== false) {
      lines.push("  - cancel option: 取消");
    }
  }

  return lines.join("\n");
}

export function createAskUserQuestionTool(): RuntimeTool {
  return {
    name: "ask_user_question",
    description: buildToolDescription({
      usageScenarios: [
        "Pause the current run and request missing user clarification.",
        "Ask one structured question or a short batch of structured questions."
      ],
      usageInstructions: [
        "Use question_text plus optional options for a single question.",
        "Use questions for a batch of up to 4 questions.",
        "Each question can include up to 5 quick-reply options, one recommended option, allow_cancel, and context_note."
      ],
      constraints: [
        "Use this only when the missing information cannot be resolved safely from current context.",
        "A batch can contain at most 4 questions.",
        "Each question can contain at most 5 quick-reply options."
      ],
      examples: [
        '{"question_text":"Which package should I update first?","options":[{"label":"agent","reply":"Update packages/agent first","description":"Best when the behavior change is runtime-level","is_recommended":true},{"label":"web","reply":"Update apps/web first","description":"Best when only UI text changes"}]}',
        '{"questions":[{"question_text":"Which provider should be the default?","options":[{"label":"DeepSeek","reply":"Use DeepSeek as default"}]},{"question_text":"Should I also update tests?","options":[{"label":"Yes","reply":"Update tests too","is_recommended":true},{"label":"No","reply":"Code changes only"}]}]}'
      ]
    }),
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
          maxItems: 5
        },
        allow_cancel: { type: "boolean" },
        context_note: { type: "string" },
        questions: {
          type: "array",
          items: {
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
                maxItems: 5
              },
              allow_cancel: { type: "boolean" },
              context_note: { type: "string" }
            },
            required: ["question_text"],
            additionalProperties: false
          },
          minItems: 1,
          maxItems: 4
        }
      },
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

      const normalizedQuestions = normalizeQuestions(parsed.data);
      const pendingPayload = createPendingUserQuestionPayload({
        questions: normalizedQuestions
      });

      await context.sessionManager.updateContext(context.sessionId, {
        status: "waiting_for_user_question",
        pendingPermissionRequest: null,
        pendingUserQuestionPayload: pendingPayload
      });

      return successResult(
        createToolResult({
          ok: true,
          code: "USER_QUESTION_REQUESTED",
          message:
            "Stored a structured clarification question and paused the current run.",
          data: createUserQuestionToolResultData(normalizedQuestions)
        }),
        renderQuestionSummary(pendingPayload)
      );
    }
  };
}
