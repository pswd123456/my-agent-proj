import { describe, expect, test } from "bun:test";

import { createRunShellCommandTool } from "../src/tools/run-shell-command.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

function createContext(): ToolExecutionContext {
  return {
    sessionId: "session-1",
    userId: "user-1",
    workingDirectory: process.cwd(),
    routineRepository: undefined as never,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-04-24",
      yoloMode: false,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
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
  test("uses a 120000ms timeout by default", async () => {
    const result = await createRunShellCommandTool().execute(
      {
        command: "printf ok"
      },
      createContext()
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      stdout: "ok",
      timeout_ms: 120_000
    });
  });

  test("honors per-call timeoutMs", async () => {
    const result = await createRunShellCommandTool().execute(
      {
        command: "sleep 0.2",
        timeoutMs: 50
      },
      createContext()
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("SHELL_COMMAND_TIMEOUT");
    expect(result.result.data).toMatchObject({
      timeout_ms: 50
    });
  });
});
