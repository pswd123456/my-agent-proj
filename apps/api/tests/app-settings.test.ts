import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SESSION_MAX_TURNS_LIMIT } from "@ai-app-template/domain";
import type { SessionSnapshot } from "@ai-app-template/agent";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MINIMAX_MODEL,
  FileSystemLogManager,
  createLogger,
  listSettingsPermissionToolOptions,
  createMemorySessionManager
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createApiApp } from "../src/app.js";
import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

async function createTestApp() {
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const logDir = await mkdtemp(path.join(os.tmpdir(), "api-log-"));
  const systemLogManager = new FileSystemLogManager(logDir, {
    maxBytes: 4096,
    maxFiles: 2
  });
  const apiLogger = createLogger({
    manager: systemLogManager,
    component: "api"
  });
  const settingsPermissionToolOptions = listSettingsPermissionToolOptions({
    workingDirectory: resolveApiWorkingDirectory(workspaceRoot),
    routineRepository
  }).map((tool) => tool.name);
  const settingsRepository = createMemorySettingsRepository({
    settingsPermissionToolOptions
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
        return resolveApiWorkingDirectory(workspaceRoot, input);
      },
      defaultModel: DEFAULT_MINIMAX_MODEL,
      modelService: {
        listModels() {
          return [
            {
              id: DEFAULT_MINIMAX_MODEL,
              label: "MiniMax 2.7",
              provider: "minimax",
              description: "MiniMax provider",
              configured: true,
              baseURL: "https://api.minimaxi.com/anthropic",
              supportsThinking: true,
              unavailableReason: null
            },
            {
              id: DEFAULT_DEEPSEEK_MODEL,
              label: "DeepSeek V4 Pro",
              provider: "deepseek",
              description: "DeepSeek provider",
              configured: true,
              baseURL: "https://api.deepseek.com/anthropic",
              supportsThinking: true,
              unavailableReason: null
            }
          ];
        },
        getDefaultModel() {
          return DEFAULT_MINIMAX_MODEL;
        },
        isModelSupported(model) {
          return (
            model === DEFAULT_MINIMAX_MODEL || model === DEFAULT_DEEPSEEK_MODEL
          );
        },
        isModelAvailable(model) {
          return (
            model === DEFAULT_MINIMAX_MODEL || model === DEFAULT_DEEPSEEK_MODEL
          );
        },
        assertModelAvailable(model) {
          if (
            model !== DEFAULT_MINIMAX_MODEL &&
            model !== DEFAULT_DEEPSEEK_MODEL
          ) {
            throw new Error(`Unsupported model: ${model}`);
          }

          return model;
        }
      }
    }),
    sessionManager,
    systemLogManager
  };
}

async function createSession(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  input: Record<string, unknown>
) {
  const response = await app.request("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  expect(response.status).toBe(201);
  const payload = (await response.json()) as { session: SessionSnapshot };
  return payload.session;
}

describe("createApiApp settings bootstrap", () => {
  test("creates a new session from repo defaults when no user settings exist yet", async () => {
    const { app } = await createTestApp();

    const session = await createSession(app, {
      userId: "stage5-default-user"
    });

    expect(session.context.userId).toBe("stage5-default-user");
    expect(session.workingDirectory).toBe(
      resolveApiWorkingDirectory(workspaceRoot)
    );
    expect(session.model).toBe(DEFAULT_MINIMAX_MODEL);
    expect(session.context.yoloMode).toBe(false);
    expect(session.contextWindow).toBe(200_000);
    expect(session.maxTurns).toBe(50);
  });

  test("uses updated user settings for the next newly created session", async () => {
    const { app } = await createTestApp();

    const updateResponse = await app.request(
      "/users/stage5-settings-user/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDirectory: "apps/web",
          model: DEFAULT_DEEPSEEK_MODEL,
          yoloMode: true,
          contextWindow: 123_456,
          maxTurns: 77,
          debugConversationView: true
        })
      }
    );

    expect(updateResponse.status).toBe(200);
    const updatePayload = (await updateResponse.json()) as {
      settings: { debugConversationView: boolean };
      permissionTools: Array<{ name: string }>;
    };
    expect(updatePayload.settings.debugConversationView).toBe(true);
    expect(updatePayload.permissionTools.length).toBeGreaterThan(0);

    const session = await createSession(app, {
      userId: "stage5-settings-user"
    });

    expect(session.workingDirectory).toBe(
      resolveApiWorkingDirectory(workspaceRoot, "apps/web")
    );
    expect(session.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(session.context.yoloMode).toBe(true);
    expect(session.contextWindow).toBe(123_456);
    expect(session.maxTurns).toBe(77);
  });

  test("updating user default model does not rewrite an existing session model", async () => {
    const { app } = await createTestApp();

    const session = await createSession(app, {
      userId: "stage5-existing-session-user"
    });

    const updateResponse = await app.request(
      "/users/stage5-existing-session-user/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEFAULT_DEEPSEEK_MODEL
        })
      }
    );

    expect(updateResponse.status).toBe(200);

    const existingSessionResponse = await app.request(
      `/sessions/${session.sessionId}`
    );
    expect(existingSessionResponse.status).toBe(200);
    const payload = (await existingSessionResponse.json()) as {
      session: SessionSnapshot;
    };

    expect(payload.session.model).toBe(DEFAULT_MINIMAX_MODEL);
  });

  test("syncs normalized permission rules onto the current session", async () => {
    const { app } = await createTestApp();

    const session = await createSession(app, {
      userId: "stage5-permission-user"
    });

    const response = await app.request(
      `/sessions/${session.sessionId}/settings`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yoloMode: true,
          toolAllowList: ["read_file", "run_shell_command"],
          toolAskList: ["read_file", "write_file", "make_http_request"],
          toolDenyList: ["delete_path", "make_http_request"]
        })
      }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session: SessionSnapshot;
    };

    expect(payload.session.context.yoloMode).toBe(true);
    expect(payload.session.context.toolAllowList).toEqual(["read_file"]);
    expect(payload.session.context.toolAskList).toEqual(["write_file"]);
    expect(payload.session.context.toolDenyList).toEqual(["delete_path"]);
  });

  test("returns dynamic permission tools with user settings", async () => {
    const { app } = await createTestApp();

    const response = await app.request("/users/stage5-meta-user/settings");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      settings: { toolAskList: string[] };
      permissionTools: Array<{
        name: string;
        family: string;
        capabilityPack: string | null;
      }>;
    };

    expect(payload.settings.toolAskList).toContain("read_file");
    expect(
      payload.permissionTools.some((tool) => tool.name === "read_file")
    ).toBe(true);
    expect(
      payload.permissionTools.some((tool) => tool.name === "run_shell_command")
    ).toBe(false);
  });

  test("updates the current session model through session settings", async () => {
    const { app } = await createTestApp();

    const session = await createSession(app, {
      userId: "stage5-model-user"
    });

    const response = await app.request(
      `/sessions/${session.sessionId}/settings`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEFAULT_DEEPSEEK_MODEL
        })
      }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session: SessionSnapshot;
    };

    expect(payload.session.model).toBe(DEFAULT_DEEPSEEK_MODEL);
  });

  test("defers task brief path binding until plan mode has task context", async () => {
    const { app } = await createTestApp();

    const session = await createSession(app, {
      userId: "stage5-planmode-user",
      planModeEnabled: true
    });

    expect(session.context.planModeEnabled).toBe(true);
    expect(session.context.taskBriefPath).toBeNull();

    const response = await app.request(
      `/sessions/${session.sessionId}/settings`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planModeEnabled: false
        })
      }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session: SessionSnapshot;
    };
    expect(payload.session.context.planModeEnabled).toBe(false);
    expect(payload.session.context.taskBriefPath).toBeNull();
  });

  test("clamps persisted max turns to the shared session limit", async () => {
    const { app } = await createTestApp();

    const updateResponse = await app.request(
      "/users/stage5-limit-user/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxTurns: SESSION_MAX_TURNS_LIMIT + 100
        })
      }
    );

    expect(updateResponse.status).toBe(200);
    const updatePayload = (await updateResponse.json()) as {
      settings: { maxTurns: number };
    };
    expect(updatePayload.settings.maxTurns).toBe(SESSION_MAX_TURNS_LIMIT);

    const createResponse = await app.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "stage5-limit-user",
        maxTurns: SESSION_MAX_TURNS_LIMIT + 100
      })
    });

    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as {
      session: SessionSnapshot;
    };
    expect(createPayload.session.maxTurns).toBe(SESSION_MAX_TURNS_LIMIT);
  });

  test("lists system logs with filters", async () => {
    const { app, systemLogManager } = await createTestApp();
    await systemLogManager.append({
      timestamp: new Date().toISOString(),
      level: "info",
      component: "api",
      event: "seeded",
      sessionId: "session-x",
      requestId: "req-1",
      details: { ok: true }
    });

    const response = await app.request(
      "/system-logs?sessionId=session-x&component=api&limit=10"
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]?.event).toBe("seeded");
  });

  test("writes api log on create session", async () => {
    const { app, systemLogManager } = await createTestApp();
    await app.request("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-create"
      },
      body: JSON.stringify({ userId: "log-user" })
    });

    const payload = await systemLogManager.query({
      component: "api",
      limit: 20
    });
    expect(
      payload.records.some((record) => record.event === "session_created")
    ).toBe(true);
    expect(
      payload.records.some((record) => record.requestId === "req-create")
    ).toBe(true);
  });
});
