import { z } from "zod";

import type { DelegatePermissionDecision } from "@ai-app-template/domain";
import type { DomainJsonValue } from "@ai-app-template/domain";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const delegateToolDescription = [
  "Create, inspect, continue, or resolve a delegated subagent task with one explicit action.",
  "Use wait_mode=blocking when the main task cannot continue without the delegate result.",
  "Use wait_mode=unblocking when other useful work can continue while the delegate runs.",
  "Examples:",
  '- {"action":"start","title":"Inspect parser","objective":"Read the parser code path.","parent_task_summary":"Parent needs a scoped summary."}',
  '- {"action":"start","title":"Inspect tests","objective":"Read tests in parallel.","parent_task_summary":"Parent will continue other work.","wait_mode":"unblocking","initial_check_after_ms":5000}',
  '- {"action":"get","delegate_id":"delegate_123"}',
  '- {"action":"reply","delegate_id":"delegate_123","message":"Focus on parser.ts next."}',
  '- {"action":"permission","delegate_id":"delegate_123","permission_decision":"approve"}'
].join("\n");

const delegateStartFields = [
  "title",
  "objective",
  "parent_task_summary",
  "acceptance_criteria",
  "constraints",
  "message"
] as const;

const delegateReplyOrPermissionFields = [
  "message",
  "title",
  "objective",
  "parent_task_summary",
  "acceptance_criteria",
  "constraints"
] as const;

const permissionDecisionSchema = z.enum(["approve", "reject"]);
const waitModeSchema = z.enum(["blocking", "unblocking"]);

const schema = z.object({
  action: z.enum(["start", "get", "reply", "permission"]),
  delegate_id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  parent_task_summary: z.string().min(1).optional(),
  acceptance_criteria: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  message: z.string().min(1).optional(),
  permission_decision: permissionDecisionSchema.optional(),
  wait_mode: waitModeSchema.optional(),
  initial_check_after_ms: z.number().finite().optional()
}).strict();

type DelegateToolInput = z.infer<typeof schema>;

type DelegateToolMode = "start" | "get" | "reply" | "permission";

class DelegateToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegateToolInputError";
  }
}

function hasAnyField(
  input: DelegateToolInput,
  fields: readonly (keyof DelegateToolInput)[]
): boolean {
  return fields.some((field) => typeof input[field] !== "undefined");
}

function clampInitialCheckAfterMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5_000;
  }
  return Math.max(1_000, Math.min(120_000, Math.floor(value)));
}

function resolveWaitOptions(input: DelegateToolInput): {
  waitMode: "blocking" | "unblocking";
  initialCheckAfterMs: number;
} {
  return {
    waitMode: input.wait_mode ?? "blocking",
    initialCheckAfterMs: clampInitialCheckAfterMs(input.initial_check_after_ms)
  };
}

function requireStartFields(input: DelegateToolInput): void {
  if (typeof input.delegate_id === "string") {
    throw new DelegateToolInputError(
      "To create a new delegate, remove delegate_id and provide title, objective, and parent_task_summary."
    );
  }

  if (
    typeof input.title !== "string" ||
    typeof input.objective !== "string" ||
    typeof input.parent_task_summary !== "string"
  ) {
    throw new DelegateToolInputError(
      "action=start requires title, objective, and parent_task_summary."
    );
  }
}

function resolveMode(input: DelegateToolInput): DelegateToolMode {
  switch (input.action) {
    case "start":
      requireStartFields(input);
      if (typeof input.permission_decision === "string") {
        throw new DelegateToolInputError(
          "action=start cannot include permission_decision."
        );
      }
      return "start";
    case "get":
      if (typeof input.delegate_id !== "string") {
        throw new DelegateToolInputError("action=get requires delegate_id.");
      }
      if (
        hasAnyField(input, delegateStartFields) ||
        typeof input.permission_decision === "string" ||
        typeof input.wait_mode === "string" ||
        typeof input.initial_check_after_ms === "number"
      ) {
        throw new DelegateToolInputError(
          "action=get only accepts delegate_id and cannot include wait options."
        );
      }
      return "get";
    case "reply":
      if (
        typeof input.delegate_id !== "string" ||
        typeof input.message !== "string"
      ) {
        throw new DelegateToolInputError(
          "action=reply requires delegate_id and message."
        );
      }
      if (
        hasAnyField(input, [
          "title",
          "objective",
          "parent_task_summary",
          "acceptance_criteria",
          "constraints",
          "permission_decision"
        ])
      ) {
        throw new DelegateToolInputError(
          "action=reply only accepts delegate_id and message."
        );
      }
      return "reply";
    case "permission":
      if (
        typeof input.delegate_id !== "string" ||
        typeof input.permission_decision !== "string"
      ) {
        throw new DelegateToolInputError(
          "action=permission requires delegate_id and permission_decision."
        );
      }
      if (hasAnyField(input, delegateReplyOrPermissionFields)) {
        throw new DelegateToolInputError(
          "action=permission only accepts delegate_id and permission_decision."
        );
      }
      return "permission";
  }
}

function renderSummary(input: {
  delegateId: string;
  status: string;
  expectedParentReply: string;
  round: number;
  latestSummary: string | null;
  waitMode: string;
  initialCheckAfterMs: number;
}): string {
  const lines = [
    "[delegate_agent] success",
    `- delegate: ${input.delegateId}`,
    `- status: ${input.status}`,
    `- round: ${input.round}`,
    `- wait mode: ${input.waitMode}`,
    `- initial check after ms: ${input.initialCheckAfterMs}`,
    `- expected parent reply: ${input.expectedParentReply}`
  ];
  if (input.latestSummary) {
    lines.push(`- latest response: ${input.latestSummary}`);
  }
  return lines.join("\n");
}

function toLatestResponseJson(
  latestResponse: {
    kind: string;
    summary: string;
    content: string;
    request?: {
      kind: string;
      summary: string;
      data: Record<string, DomainJsonValue>;
    } | null;
  } | null
): DomainJsonValue {
  if (!latestResponse) {
    return null;
  }

  return {
    kind: latestResponse.kind,
    summary: latestResponse.summary,
    content: latestResponse.content,
    request: latestResponse.request
      ? {
          kind: latestResponse.request.kind,
          summary: latestResponse.request.summary,
          data: latestResponse.request.data
        }
      : null
  };
}

function createUnavailableResult() {
  return failureResult(
    createToolResult({
      ok: false,
      code: "DELEGATE_AGENT_UNAVAILABLE",
      message: "delegate_agent is not configured in the current runtime."
    }),
    "[delegate_agent] unavailable\n- delegate service is not configured"
  );
}

function createFailureResult(message: string) {
  return failureResult(
    createToolResult({
      ok: false,
      code: "DELEGATE_AGENT_FAILED",
      message
    }),
    `[delegate_agent] failed\n- ${message}`
  );
}

export function createDelegateAgentTool(): RuntimeTool {
  return {
    name: "delegate_agent",
    description: delegateToolDescription,
    family: "delegation",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "get", "reply", "permission"],
          description:
            "Choose one explicit action: start, get, reply, or permission."
        },
        delegate_id: { type: "string" },
        title: {
          type: "string",
          description: "Required for action=start."
        },
        objective: {
          type: "string",
          description: "Required for action=start."
        },
        parent_task_summary: {
          type: "string",
          description: "Required for action=start."
        },
        acceptance_criteria: {
          type: "array",
          items: { type: "string" },
          description: "Optional for action=start."
        },
        constraints: {
          type: "array",
          items: { type: "string" },
          description: "Optional for action=start."
        },
        message: {
          type: "string",
          description: "Required for action=reply. Optional for action=start."
        },
        permission_decision: {
          type: "string",
          enum: ["approve", "reject"],
          description: "Required for action=permission."
        },
        wait_mode: {
          type: "string",
          enum: ["blocking", "unblocking"],
          description:
            "Optional for action=start, action=reply, or action=permission. Defaults to blocking."
        },
        initial_check_after_ms: {
          type: "number",
          description:
            "Optional for wait_mode=unblocking. Runtime clamps to 1000..120000 ms."
        }
      },
      required: ["action"],
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
          `[delegate_agent] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      if (!context.delegateAgentService) {
        return createUnavailableResult();
      }

      try {
        const mode = resolveMode(parsed.data);
        const waitOptions = resolveWaitOptions(parsed.data);
        const service = context.delegateAgentService;
        const view =
          mode === "start"
            ? await service.startDelegate({
                parentSessionId: context.sessionId,
                title: parsed.data.title!,
                objective: parsed.data.objective!,
                parentTaskSummary: parsed.data.parent_task_summary!,
                ...(parsed.data.acceptance_criteria
                  ? { acceptanceCriteria: parsed.data.acceptance_criteria }
                  : {}),
                ...(parsed.data.constraints
                  ? { constraints: parsed.data.constraints }
                  : {}),
                ...(parsed.data.message ? { message: parsed.data.message } : {})
              })
            : mode === "get"
              ? await service.getDelegate(parsed.data.delegate_id!)
              : mode === "reply"
                ? await service.replyToDelegate(
                    parsed.data.delegate_id!,
                    parsed.data.message!
                  )
                : await service.resolveDelegatePermission(
                    parsed.data.delegate_id!,
                    parsed.data.permission_decision as DelegatePermissionDecision
                  );

        const output = {
          delegate_id: view.delegateId,
          status: view.status,
          latest_response: toLatestResponseJson(view.latestResponse),
          expected_parent_reply: view.expectedParentReply,
          round: view.round,
          wait_mode: waitOptions.waitMode,
          initial_check_after_ms: waitOptions.initialCheckAfterMs
        };

        return successResult(
          createToolResult({
            ok: true,
            code: "DELEGATE_AGENT_OK",
            message: "Handled delegate agent request.",
            data: output
          }),
          renderSummary({
            delegateId: view.delegateId,
            status: view.status,
            expectedParentReply: view.expectedParentReply,
            round: view.round,
            latestSummary: view.latestResponse?.summary ?? null,
            waitMode: waitOptions.waitMode,
            initialCheckAfterMs: waitOptions.initialCheckAfterMs
          })
        );
      } catch (error) {
        if (error instanceof DelegateToolInputError) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "INVALID_TOOL_INPUT",
              message: error.message
            }),
            `[delegate_agent] invalid input\n- ${error.message}`
          );
        }
        return createFailureResult(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  };
}
