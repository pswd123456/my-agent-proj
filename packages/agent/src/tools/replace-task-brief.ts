import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  describeTaskBriefBinding,
  normalizeTaskBriefPlanName,
  resolveTaskBriefPath
} from "../session/task-brief.js";
import { createTaskBriefWriteAck } from "./planning-tool-result.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { writeTextFileAtomic } from "./workspace.js";

const schema = z.object({
  plan_name: z.string().min(1).optional(),
  content: z.string().min(1)
});

async function getBoundTaskBriefPath(
  context: Parameters<RuntimeTool["execute"]>[1],
  planName: string | undefined
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const binding = describeTaskBriefBinding({
    workingDirectory: context.workingDirectory,
    sessionId: context.sessionId,
    taskBriefPath: context.sessionContext.taskBriefPath
  });

  if (binding.state === "bound_named" && binding.path) {
    if (typeof planName === "string" && planName.trim().length > 0) {
      const normalizedPlanName = normalizeTaskBriefPlanName(planName);
      if (!normalizedPlanName) {
        return {
          ok: false,
          message: "The provided plan_name is invalid."
        };
      }
      const nextPath = resolveTaskBriefPath(
        context.workingDirectory,
        context.sessionId,
        normalizedPlanName
      );
      if (binding.path !== nextPath) {
        return {
          ok: false,
          message:
            "This session already has a named task brief path. Omit plan_name or reuse the existing plan name."
        };
      }
    }

    return { ok: true, path: binding.path };
  }

  if (binding.state === "bound_legacy" && binding.path) {
    if (typeof planName === "string" && planName.trim().length > 0) {
      const normalizedPlanName = normalizeTaskBriefPlanName(planName);
      if (!normalizedPlanName) {
        return {
          ok: false,
          message: "The provided plan_name is invalid."
        };
      }
      const nextPath = resolveTaskBriefPath(
        context.workingDirectory,
        context.sessionId,
        normalizedPlanName
      );
      await context.sessionManager.updateContext(context.sessionId, {
        taskBriefPath: nextPath
      });
      context.sessionContext.taskBriefPath = nextPath;
      return { ok: true, path: nextPath };
    }

    if (existsSync(binding.path)) {
      return { ok: true, path: binding.path };
    }

    return {
      ok: false,
      message:
        "This session uses a legacy task brief binding without a file yet. Provide plan_name on the next replace_task_brief call to upgrade it to a named path."
    };
  }

  if (binding.state === "invalid") {
    return {
      ok: false,
      message: "The bound task brief path is invalid for the current session."
    };
  }

  if (!context.sessionContext.planModeEnabled) {
    return {
      ok: false,
      message: "This session does not have a bound task brief path yet."
    };
  }

  if (typeof planName !== "string" || planName.trim().length === 0) {
    return {
      ok: false,
      message:
        "This session does not have a bound task brief path yet. Provide plan_name when creating the first task brief."
    };
  }
  const normalizedPlanName = normalizeTaskBriefPlanName(planName);
  if (!normalizedPlanName) {
    return {
      ok: false,
      message: "The provided plan_name is invalid."
    };
  }

  const nextPath = resolveTaskBriefPath(
    context.workingDirectory,
    context.sessionId,
    normalizedPlanName
  );
  await context.sessionManager.updateContext(context.sessionId, {
    taskBriefPath: nextPath
  });
  context.sessionContext.taskBriefPath = nextPath;
  return { ok: true, path: nextPath };
}

export function createReplaceTaskBriefTool(): RuntimeTool {
  return {
    name: "replace_task_brief",
    description:
      "Create or fully replace the current session task brief markdown file used by plan mode. Use this tool for task brief writes only; do not use shell redirection or workspace file mutation tools to write the brief. When the session does not have a task brief path yet, include a short plan_name for the file.",
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        plan_name: { type: "string" },
        content: { type: "string" }
      },
      required: ["content"],
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
          `[replace_task_brief] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const boundPath = await getBoundTaskBriefPath(
        context,
        parsed.data.plan_name
      );
      if (!boundPath.ok) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "TASK_BRIEF_PATH_UNAVAILABLE",
            message: boundPath.message
          }),
          `[replace_task_brief] failed\n- ${boundPath.message}`
        );
      }

      try {
        await fs.mkdir(path.dirname(boundPath.path), { recursive: true });
        await writeTextFileAtomic(boundPath.path, parsed.data.content);
        const data = createTaskBriefWriteAck({
          path: boundPath.path
        });

        return successResult(
          createToolResult({
            ok: true,
            code: "TASK_BRIEF_REPLACED",
            message: "Replaced the current session task brief.",
            data
          }),
          [
            "[replace_task_brief] success",
            `- path: ${boundPath.path}`
          ].join("\n")
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to replace the task brief.";
        return failureResult(
          createToolResult({
            ok: false,
            code: "TASK_BRIEF_WRITE_FAILED",
            message
          }),
          `[replace_task_brief] failed\n- ${message}`
        );
      }
    }
  };
}
