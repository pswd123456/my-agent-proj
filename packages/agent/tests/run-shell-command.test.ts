import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";

import { createMemoryBackgroundTaskRepository } from "@ai-app-template/db";

import { createBackgroundTaskManager } from "../src/index.js";
import { createRunShellCommandTool } from "../src/tools/run-shell-command.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

async function createContext(): Promise<ToolExecutionContext> {
  const sessionManager = await createPostgresTestSessionManager();
  const backgroundTaskManager = createBackgroundTaskManager({
    sessionManager,
    repository: createMemoryBackgroundTaskRepository()
  });
  const session = await sessionManager.createSession({
    workingDirectory: process.cwd(),
    userId: "user-1"
  });

  return {
    sessionId: session.sessionId,
    userId: "user-1",
    workingDirectory: process.cwd(),
    routineRepository: undefined as never,
    sessionManager,
    backgroundTaskManager,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-04-29",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      todoState: null
    },
    permissionRules: {
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionMessages: []
  };
}

describe("run_shell_command", () => {
  test("description prefers structured workspace inspection tools over shell text utilities", () => {
    const tool = createRunShellCommandTool();

    expect(tool.description).toContain(
      "Prefer structured workspace tools such as search_text, read_file, git_diff, and git_status"
    );
    expect(tool.description).toContain(
      "Do not use shell text utilities like cat, sed, grep, awk, or perl"
    );
  });

  test("runs shell commands inline by default", async () => {
    const context = await createContext();
    const result = await createRunShellCommandTool().execute(
      {
        action: "start",
        command: "printf ok"
      },
      context
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("SHELL_COMMAND_COMPLETED");
    expect(result.result.data).toMatchObject({
      execution_mode: "inline",
      command: "printf ok",
      timeout_ms: 120_000,
      stdout: "ok",
      termination_reason: "completed"
    });
    expect(result.details).toEqual({
      kind: "shell_command",
      action: "start",
      command: "printf ok",
      executionMode: "inline"
    });
  });

  test("loads a queued background shell task via action=get", async () => {
    const context = await createContext();
    const started = await createRunShellCommandTool().execute(
      {
        action: "start",
        command: "sleep 1",
        execution_mode: "background",
        wait_mode: "unblocking",
        timeout_ms: 50
      },
      context
    );
    const taskId = (started.result.data as { task_id: string }).task_id;

    const loaded = await createRunShellCommandTool().execute(
      {
        action: "get",
        task_id: taskId
      },
      context
    );

    expect(loaded.state).toBe("success");
    expect(loaded.result.code).toBe("SHELL_COMMAND_TASK");
    expect(loaded.result.data).toMatchObject({
      task_id: taskId,
      execution_mode: "background",
      command: "sleep 1",
      timeout_ms: 50,
      wait_mode: "unblocking"
    });
    expect(loaded.details).toEqual({
      kind: "shell_command",
      action: "get",
      command: "sleep 1",
      executionMode: "background",
      taskId
    });
  });

  test("creates an explicit background shell task without a child session", async () => {
    const context = await createContext();
    const result = await createRunShellCommandTool().execute(
      {
        action: "start",
        command: "sleep 1",
        execution_mode: "background"
      },
      context
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("BACKGROUND_TASK_ACCEPTED");
    expect(result.result.data).toMatchObject({
      execution_mode: "background",
      command: "sleep 1",
      wait_mode: "blocking"
    });

    const taskId = (result.result.data as { task_id: string }).task_id;
    const task = await context.backgroundTaskManager?.getTask(taskId);
    expect(task?.childSessionId).toBeNull();
  });
});
