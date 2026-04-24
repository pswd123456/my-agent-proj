import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import type { RuntimeTool } from "./runtime-tool.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";
import { truncateText } from "./workspace.js";

const exec = promisify(execCallback);

export function createRunShellCommandTool(): RuntimeTool {
  return {
    name: "run_shell_command",
    description: "Run one shell command from the session working directory after approval.",
    family: "workspace-shell",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "always-ask-user",
    sandboxProfile: "workspace-working-directory",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute."
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds."
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    async getPermissionRequest(input) {
      const command = typeof input.command === "string" ? input.command.trim() : "";
      if (!command) {
        return null;
      }

      return {
        summaryText: `需要你的确认后才能执行 shell 命令：${command}`,
      };
    },
    validate(input) {
      const command = input.command;
      if (typeof command === "string" && command.trim()) {
        return { ok: true, value: input };
      }

      return {
        ok: false,
        issues: [{ field: "command", issue: "command is required." }]
      };
    },
    async execute(input, context) {
      const command =
        typeof input.command === "string" ? input.command.trim() : "";
      const timeoutMs =
        typeof input.timeoutMs === "number" && input.timeoutMs > 0
          ? Math.floor(input.timeoutMs)
          : 30_000;

      if (!command) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing command.",
            validationErrors: [{ field: "command", issue: "command is required." }]
          }),
          "[run_shell_command] invalid input"
        );
      }

      try {
        const { stdout, stderr } = await exec(command, {
          cwd: context.workingDirectory,
          signal: context.abortSignal,
          timeout: timeoutMs,
          maxBuffer: 512 * 1024
        });
        return successResult(
          createToolResult({
            ok: true,
            code: "SHELL_COMMAND_OK",
            message: "Shell command completed.",
            data: {
              command,
              stdout: truncateText(stdout, 12_000),
              stderr: truncateText(stderr, 6_000),
              working_directory: context.workingDirectory
            }
          }),
          `[run_shell_command] success\n- ${command}`
        );
      } catch (error) {
        if (context.abortSignal?.aborted) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "SHELL_COMMAND_INTERRUPTED",
              message: "Interrupted by user."
            }),
            "[run_shell_command] interrupted\n- interrupted by user"
          );
        }

        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "SHELL_COMMAND_FAILED",
            message
          }),
          `[run_shell_command] failed\n- ${message}`
        );
      }
    }
  };
}
