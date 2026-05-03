import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import type {
  BackgroundTaskHandle,
  BackgroundTaskRecord,
  BackgroundTaskResultEnvelope,
  ShellCommandResultEnvelope,
  DomainJsonValue,
  BackgroundTaskWaitMode,
  ShellCommandTaskState
} from "@ai-app-template/domain";

import { incrementSessionBackgroundTaskCount } from "../background-tasks/notifications.js";
import { buildBackgroundTaskHandle } from "../background-tasks/task-handle.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { truncateText } from "./workspace.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const SHELL_OUTPUT_STDOUT_LIMIT = 12_000;
const SHELL_OUTPUT_STDERR_LIMIT = 6_000;
const exec = promisify(execCallback);

const schema = z
  .object({
    action: z.enum(["start", "get", "cancel"]),
    command: z.string().min(1).optional(),
    execution_mode: z.enum(["inline", "background"]).optional(),
    wait_mode: z.enum(["blocking", "unblocking"]).optional(),
    timeout_ms: z.number().finite().positive().optional(),
    task_id: z.string().min(1).optional()
  })
  .strict();

type RunShellCommandInput = z.infer<typeof schema>;

function normalizeTimeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_TIMEOUT_MS;
}

function resolveWaitMode(input: RunShellCommandInput): BackgroundTaskWaitMode {
  return input.wait_mode === "unblocking" ? "unblocking" : "blocking";
}

function resolveExecutionMode(input: RunShellCommandInput): "inline" | "background" {
  return input.execution_mode === "background" ? "background" : "inline";
}

function isActiveStatus(status: BackgroundTaskRecord["status"]): boolean {
  return (
    status === "queued" ||
    status === "claimed" ||
    status === "running" ||
    status === "cancelling"
  );
}

function requireModeShape(input: RunShellCommandInput): string | null {
  if (input.action === "start") {
    if (typeof input.command !== "string") {
      return "action=start requires command.";
    }

    if (
      resolveExecutionMode(input) === "inline" &&
      typeof input.wait_mode === "string"
    ) {
      return "wait_mode is only supported when execution_mode=background.";
    }

    return null;
  }

  if (typeof input.task_id !== "string") {
    return `action=${input.action} requires task_id.`;
  }

  if (
    typeof input.command === "string" ||
    typeof input.wait_mode === "string" ||
    typeof input.timeout_ms === "number" ||
    typeof input.execution_mode === "string"
  ) {
    return `action=${input.action} only accepts task_id.`;
  }

  return null;
}

function renderHandle(
  handle: BackgroundTaskHandle
): Record<string, DomainJsonValue> {
  return {
    task_id: handle.taskId,
    task_kind: handle.taskKind,
    status: handle.status,
    wait_mode: handle.waitMode,
    initial_check_after_ms: handle.initialCheckAfterMs
  };
}

function readShellTaskState(
  task: BackgroundTaskRecord
): ShellCommandTaskState | null {
  return task.taskState?.kind === "shell_command" ? task.taskState : null;
}

function toShellResultJson(
  result: BackgroundTaskResultEnvelope | null
): Record<string, DomainJsonValue> | null {
  if (!result || result.type !== "shell_command") {
    return null;
  }

  return {
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    working_directory: result.workingDirectory,
    timeout_ms: result.timeoutMs,
    exit_code: result.exitCode,
    termination_reason: result.terminationReason
  };
}

function toTaskOutput(task: BackgroundTaskRecord): {
  task_id: string;
  status: BackgroundTaskRecord["status"];
  command: string;
  execution_mode: "background";
  wait_mode: BackgroundTaskWaitMode;
  timeout_ms: number;
  latest_result: Record<string, DomainJsonValue> | null;
  background_task?: Record<string, DomainJsonValue>;
} {
  const taskState = readShellTaskState(task);
  const waitMode = taskState?.waitMode ?? "blocking";
  const timeoutMs =
    taskState?.timeoutMs ??
    (task.payload.executor === "shell_command" ? task.payload.timeoutMs : DEFAULT_TIMEOUT_MS);
  const command =
    taskState?.command ??
    (task.payload.executor === "shell_command" ? task.payload.command : "");
  const handle = buildBackgroundTaskHandle({
    task,
    waitMode,
    initialCheckAfterMs: 5_000
  });

  return {
    task_id: task.taskId,
    status: task.status,
    command,
    execution_mode: "background",
    wait_mode: waitMode,
    timeout_ms: timeoutMs,
    latest_result: toShellResultJson(taskState?.latestResult ?? null),
    ...(isActiveStatus(task.status)
      ? { background_task: renderHandle(handle) }
      : {})
  };
}

async function loadShellTask(input: {
  taskId: string;
  context: Parameters<RuntimeTool["execute"]>[1];
}): Promise<BackgroundTaskRecord | null> {
  const manager = input.context.backgroundTaskManager;
  if (!manager) {
    return null;
  }

  const task = await manager.getTask(input.taskId);
  if (!task || task.kind !== "shell_command") {
    return null;
  }

  return task;
}

function createShellCommandResult(input: {
  command: string;
  stdout: string;
  stderr: string;
  workingDirectory: string;
  timeoutMs: number;
  exitCode: number | null;
  terminationReason: ShellCommandResultEnvelope["terminationReason"];
}): ShellCommandResultEnvelope {
  return {
    type: "shell_command",
    command: input.command,
    stdout: truncateText(input.stdout, SHELL_OUTPUT_STDOUT_LIMIT),
    stderr: truncateText(input.stderr, SHELL_OUTPUT_STDERR_LIMIT),
    workingDirectory: input.workingDirectory,
    timeoutMs: input.timeoutMs,
    exitCode: input.exitCode,
    terminationReason: input.terminationReason
  };
}

function toInlineShellResultData(
  result: ShellCommandResultEnvelope
): Record<string, DomainJsonValue> {
  return {
    execution_mode: "inline",
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    working_directory: result.workingDirectory,
    timeout_ms: result.timeoutMs,
    exit_code: result.exitCode,
    termination_reason: result.terminationReason
  };
}

async function executeInlineShellCommand(input: {
  command: string;
  timeoutMs: number;
  context: Parameters<RuntimeTool["execute"]>[1];
}) {
  const abortController = new AbortController();
  let timedOut = false;
  const onAbort = () => {
    abortController.abort();
  };

  if (input.context.abortSignal?.aborted) {
    abortController.abort();
  } else {
    input.context.abortSignal?.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const { stdout, stderr } = await exec(input.command, {
      cwd: input.context.workingDirectory,
      signal: abortController.signal,
      timeout: input.timeoutMs,
      maxBuffer: 512 * 1024
    });
    const result = createShellCommandResult({
      command: input.command,
      stdout,
      stderr,
      workingDirectory: input.context.workingDirectory,
      timeoutMs: input.timeoutMs,
      exitCode: 0,
      terminationReason: "completed"
    });
    return successResult(
      createToolResult({
        ok: true,
        code: "SHELL_COMMAND_COMPLETED",
        message: "Shell command completed inline.",
        data: toInlineShellResultData(result)
      }),
      `[run_shell_command] success\n- inline\n- ${input.command}`
    );
  } catch (error) {
    const shellError = error as NodeJS.ErrnoException & {
      code?: number | string;
      killed?: boolean;
      signal?: NodeJS.Signals;
      stdout?: string;
      stderr?: string;
    };
    const interrupted =
      abortController.signal.aborted &&
      !timedOut &&
      input.context.abortSignal?.aborted === true;
    const terminationReason: ShellCommandResultEnvelope["terminationReason"] =
      interrupted
        ? "interrupted"
        : shellError.killed && shellError.signal === "SIGTERM"
          ? "timeout"
          : "failed";
    const result = createShellCommandResult({
      command: input.command,
      stdout: shellError.stdout ?? "",
      stderr: shellError.stderr ?? "",
      workingDirectory: input.context.workingDirectory,
      timeoutMs: input.timeoutMs,
      exitCode: typeof shellError.code === "number" ? shellError.code : null,
      terminationReason
    });
    const code =
      terminationReason === "interrupted"
        ? "SHELL_COMMAND_INTERRUPTED"
        : terminationReason === "timeout"
          ? "SHELL_COMMAND_TIMEOUT"
          : "SHELL_COMMAND_FAILED";
    const message =
      terminationReason === "interrupted"
        ? "Shell command interrupted."
        : terminationReason === "timeout"
          ? "Shell command timed out."
          : error instanceof Error
            ? error.message
            : String(error);

    return failureResult(
      createToolResult({
        ok: false,
        code,
        message,
        data: toInlineShellResultData(result)
      }),
      `[run_shell_command] failed\n- inline ${terminationReason}\n- ${input.command}`
    );
  } finally {
    input.context.abortSignal?.removeEventListener("abort", onAbort);
  }
}

export function createRunShellCommandTool(): RuntimeTool {
  return {
    name: "run_shell_command",
    description: buildToolDescription({
      usageScenarios: [
        "Run a shell command in the session working directory.",
        "Start a background shell task and later inspect or cancel it."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "action",
          type: '"start" | "get" | "cancel"',
          required: true,
          description: "Choose whether to start a command, inspect a background task, or cancel one."
        }),
        "For action=start, provide command. execution_mode defaults to inline.",
        "Use execution_mode=background to create a detached task.",
        "Use wait_mode only with action=start and execution_mode=background.",
        "For action=get and action=cancel, provide task_id only."
      ],
      constraints: [
        "Shell execution is destructive and requires approval.",
        "Prefer structured workspace tools such as search_text, read_file, git_diff, and git_status for repository inspection before using shell.",
        "Do not use shell text utilities like cat, sed, grep, awk, or perl just to inspect file contents that read_file or search_text can already provide.",
        "action=get only inspects a background task and does not require command.",
        "action=cancel only accepts task_id.",
        "Inline commands return one result; background commands return task state and may continue after the current run."
      ],
      examples: [
        '{"action":"start","command":"git status"}',
        '{"action":"start","command":"bun run dev","execution_mode":"background","wait_mode":"unblocking"}',
        '{"action":"get","task_id":"task_123"}',
        '{"action":"cancel","task_id":"task_123"}'
      ]
    }),
    family: "workspace-shell",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "destructive-only",
    sandboxProfile: "workspace-working-directory",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "get", "cancel"]
        },
        command: {
          type: "string",
          description: "Required for action=start."
        },
        execution_mode: {
          type: "string",
          enum: ["inline", "background"],
          description:
            "Optional for action=start. Defaults to inline. Use background to create a detached task."
        },
        wait_mode: {
          type: "string",
          enum: ["blocking", "unblocking"],
          description:
            "Optional for action=start when execution_mode=background. Defaults to blocking."
        },
        timeout_ms: {
          type: "number",
          description: "Optional for action=start."
        },
        task_id: {
          type: "string",
          description: "Required for action=get and action=cancel."
        }
      },
      required: ["action"],
      additionalProperties: false
    },
    async getPermissionRequest(input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return null;
      }

      if (parsed.data.action === "get") {
        return null;
      }

      if (parsed.data.action === "cancel") {
        return {
          summaryText: `需要你的确认后才能取消后台任务：${parsed.data.task_id ?? ""}`
        };
      }

      const command = parsed.data.command?.trim() ?? "";
      if (!command) {
        return null;
      }

      return {
        summaryText: `需要你的确认后才能执行 shell 命令：${command}`
      };
    },
    validate(input) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return validateWithSchema(schema, input);
      }

      const issue = requireModeShape(parsed.data);
      if (!issue) {
        return { ok: true, value: input };
      }

      return {
        ok: false,
        issues: [{ field: "action", issue }]
      };
    },
    async execute(input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Tool input validation failed.",
            validationErrors: parsed.error.issues.map((issue) => ({
              field: issue.path.join(".") || "input",
              issue: issue.message
            }))
          }),
          "[run_shell_command] invalid input"
        );
      }

      const issue = requireModeShape(parsed.data);
      if (issue) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: issue
          }),
          `[run_shell_command] invalid input\n- ${issue}`
        );
      }

      if (parsed.data.action === "get") {
        const taskManager = context.backgroundTaskManager;
        if (!taskManager) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "SHELL_COMMAND_UNAVAILABLE",
              message: "background task manager is not configured."
            }),
            "[run_shell_command] unavailable\n- background task manager is not configured"
          );
        }
        const task = await loadShellTask({
          taskId: parsed.data.task_id!,
          context
        });
        if (!task) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "SHELL_COMMAND_NOT_FOUND",
              message: "Background shell task not found."
            }),
            `[run_shell_command] failed\n- shell task not found: ${parsed.data.task_id}`
          );
        }

        return successResult(
          createToolResult({
            ok: true,
            code: "SHELL_COMMAND_TASK",
            message: "Loaded background shell task.",
            data: toTaskOutput(task)
          }),
          `[run_shell_command] success\n- task: ${task.taskId}\n- status: ${task.status}`
        );
      }

      if (parsed.data.action === "cancel") {
        const taskManager = context.backgroundTaskManager;
        if (!taskManager) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "SHELL_COMMAND_UNAVAILABLE",
              message: "background task manager is not configured."
            }),
            "[run_shell_command] unavailable\n- background task manager is not configured"
          );
        }
        const task = await loadShellTask({
          taskId: parsed.data.task_id!,
          context
        });
        if (!task) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "SHELL_COMMAND_NOT_FOUND",
              message: "Background shell task not found."
            }),
            `[run_shell_command] failed\n- shell task not found: ${parsed.data.task_id}`
          );
        }

        const cancelled = await taskManager.requestCancel(task.taskId);
        return successResult(
          createToolResult({
            ok: true,
            code: "SHELL_COMMAND_CANCEL_REQUESTED",
            message: "Cancel requested for background shell task.",
            data: {
              task_id: task.taskId,
              status: cancelled?.status ?? task.status
            }
          }),
          `[run_shell_command] success\n- cancel requested: ${task.taskId}`
        );
      }

      const session = await context.sessionManager.getSession(context.sessionId);
      if (!session) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "SHELL_COMMAND_SESSION_NOT_FOUND",
            message: `Unknown session: ${context.sessionId}`
          }),
          `[run_shell_command] failed\n- unknown session: ${context.sessionId}`
        );
      }

      const command = parsed.data.command!.trim();
      const executionMode = resolveExecutionMode(parsed.data);
      const timeoutMs = normalizeTimeoutMs(parsed.data.timeout_ms);
      if (executionMode === "inline") {
        return executeInlineShellCommand({
          command,
          timeoutMs,
          context
        });
      }

      const taskManager = context.backgroundTaskManager;
      if (!taskManager) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "SHELL_COMMAND_UNAVAILABLE",
            message: "background task manager is not configured."
          }),
          "[run_shell_command] unavailable\n- background task manager is not configured"
        );
      }

      const waitMode = resolveWaitMode(parsed.data);
      const taskState: ShellCommandTaskState = {
        kind: "shell_command",
        command,
        waitMode,
        timeoutMs,
        latestResult: null
      };
      const task = await taskManager.enqueueTask({
        kind: "shell_command",
        executor: "shell_command",
        parentSessionId: session.sessionId,
        workingDirectory: session.workingDirectory,
        model: session.model,
        maxTurns: session.maxTurns,
        userId: session.context.userId,
        enabledCapabilityPacks: session.context.enabledCapabilityPacks,
        message: "",
        command,
        timeoutMs,
        taskState
      });
      await incrementSessionBackgroundTaskCount({
        sessionManager: context.sessionManager,
        sessionId: session.sessionId,
        delta: 1
      });

      const handle = buildBackgroundTaskHandle({
        task,
        waitMode,
        initialCheckAfterMs: 5_000
      });

      return successResult(
        createToolResult({
          ok: true,
          code: "BACKGROUND_TASK_ACCEPTED",
          message: "Background shell task started.",
          data: {
            task_id: task.taskId,
            status: task.status,
            command,
            execution_mode: "background",
            wait_mode: waitMode,
            timeout_ms: timeoutMs,
            background_task: renderHandle(handle)
          }
        }),
        `[run_shell_command] success\n- task: ${task.taskId}\n- ${command}`
      );
    }
  };
}
