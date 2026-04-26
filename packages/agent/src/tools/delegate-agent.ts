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

const permissionDecisionSchema = z.enum(["approve", "reject"]);

const schema = z.object({
  delegate_id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  objective: z.string().min(1).optional(),
  parent_task_summary: z.string().min(1).optional(),
  acceptance_criteria: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  message: z.string().min(1).optional(),
  permission_decision: permissionDecisionSchema.optional()
});

type DelegateToolInput = z.infer<typeof schema>;

type DelegateToolMode = "start" | "get" | "reply" | "permission";

function resolveMode(input: DelegateToolInput): DelegateToolMode {
  const hasDelegateId = typeof input.delegate_id === "string";
  const hasMessage = typeof input.message === "string";
  const hasPermissionDecision = typeof input.permission_decision === "string";
  const hasStartFields =
    typeof input.title === "string" ||
    typeof input.objective === "string" ||
    typeof input.parent_task_summary === "string" ||
    Array.isArray(input.acceptance_criteria) ||
    Array.isArray(input.constraints);

  if (!hasDelegateId) {
    if (hasPermissionDecision) {
      throw new Error("permission_decision requires delegate_id.");
    }
    if (
      typeof input.title !== "string" ||
      typeof input.objective !== "string" ||
      typeof input.parent_task_summary !== "string"
    ) {
      throw new Error(
        "Starting a delegate requires title, objective, and parent_task_summary."
      );
    }
    return "start";
  }

  if (hasPermissionDecision) {
    if (hasMessage || hasStartFields) {
      throw new Error(
        "permission_decision cannot be combined with message or start fields."
      );
    }
    return "permission";
  }

  if (hasMessage) {
    if (hasStartFields) {
      throw new Error(
        "Reply mode cannot be combined with title, objective, or task card fields."
      );
    }
    return "reply";
  }

  if (hasStartFields) {
    throw new Error(
      "Task card fields are only allowed when creating a new delegate."
    );
  }

  return "get";
}

function renderSummary(input: {
  delegateId: string;
  status: string;
  expectedParentReply: string;
  round: number;
  latestSummary: string | null;
}): string {
  const lines = [
    "[delegate_agent] success",
    `- delegate: ${input.delegateId}`,
    `- status: ${input.status}`,
    `- round: ${input.round}`,
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
    description:
      "Create, inspect, continue, or resolve a delegated subagent task without sharing full child-session history back to the parent.",
    family: "delegation",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        delegate_id: { type: "string" },
        title: { type: "string" },
        objective: { type: "string" },
        parent_task_summary: { type: "string" },
        acceptance_criteria: {
          type: "array",
          items: { type: "string" }
        },
        constraints: {
          type: "array",
          items: { type: "string" }
        },
        message: { type: "string" },
        permission_decision: {
          type: "string",
          enum: ["approve", "reject"]
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
          round: view.round
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
            latestSummary: view.latestResponse?.summary ?? null
          })
        );
      } catch (error) {
        return createFailureResult(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  };
}
