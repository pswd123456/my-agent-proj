import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FileSystemLogManager,
  createLogger,
  type SessionSnapshot
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createApiApp } from "../src/app.js";

async function createTestApp(workspaceRoot: string) {
  const sessionManager = await createPostgresTestSessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();
  const logDir = await mkdtemp(path.join(os.tmpdir(), "api-interrupt-log-"));
  const systemLogManager = new FileSystemLogManager(logDir, {
    maxBytes: 4096,
    maxFiles: 2
  });
  const apiLogger = createLogger({
    manager: systemLogManager,
    component: "api"
  });

  return {
    app: createApiApp({
      sessionManager,
      routineRepository,
      settingsRepository,
      traceManager: {
        async appendEvent() {},
        async readEvents() {
          return [];
        },
        async deleteEvents() {}
      },
      systemLogManager,
      apiLogger,
      buildWorkingDirectory(input) {
        return input ? path.resolve(workspaceRoot, input) : workspaceRoot;
      },
      defaultModel: "MiniMax-M2.7"
    }),
    sessionManager
  };
}

describe("session interrupt API", () => {
  test("uses the stop endpoint to repair a paused session without an active run", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "api-interrupt-workspace-")
    );
    const { app, sessionManager } = await createTestApp(workspaceRoot);
    const createResponse = await app.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "interrupt-user" })
    });
    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as {
      session: SessionSnapshot;
    };

    await sessionManager.updateContext(createPayload.session.sessionId, {
      status: "waiting_for_permission",
      pendingPermissionRequest: {
        toolCallId: "call-1",
        toolName: "read_file",
        toolInput: { path: "../README.md" },
        family: "workspace-file",
        permissionProfile: "always-ask-user",
        summaryText: "读取 workspace 外文件",
        createdAt: "2026-04-30T00:00:00.000Z"
      }
    });

    const interruptResponse = await app.request(
      `/sessions/${createPayload.session.sessionId}/interrupt`,
      {
        method: "POST"
      }
    );

    expect(interruptResponse.status).toBe(200);
    const payload = (await interruptResponse.json()) as {
      mode: string;
      session: SessionSnapshot;
    };
    expect(payload.mode).toBe("force_stopped");
    expect(payload.session.context.status).toBe("waiting_for_user_input");
    expect(payload.session.context.pendingPermissionRequest).toBeNull();
    expect(payload.session.sessionState.loopState).toBe("interrupted");
    expect(payload.session.sessionState.interruptRequested).toBe(false);
  });
});
