import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { mkdtemp, rm } from "node:fs/promises";
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
  userSettingsMcpPayloadSchema
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createApiApp } from "../src/app.js";
import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

async function createTestApp() {
  const sessionManager = await createPostgresTestSessionManager();
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
              thinkingEfforts: [],
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
              thinkingEfforts: ["high", "max"],
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
        supportsThinking() {
          return true;
        },
        getThinkingEfforts(model) {
          return model === DEFAULT_DEEPSEEK_MODEL ? ["high", "max"] : [];
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
    const { app, sessionManager } = await createTestApp();

    const session = await createSession(app, {
      userId: "stage5-default-user"
    });

    expect(session.context.userId).toBe(
      sessionManager.testUserId("stage5-default-user")
    );
    expect(session.workingDirectory).toBe(
      resolveApiWorkingDirectory(workspaceRoot)
    );
    expect(session.model).toBe(DEFAULT_MINIMAX_MODEL);
    expect(session.context.yoloMode).toBe(false);
    expect(session.contextWindow).toBe(200_000);
    expect(session.maxTurns).toBe(100);
    expect(session.context.enabledCapabilityPacks).toEqual([
      "workspace",
      "schedule",
      "lsp"
    ]);
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
          thinkingEffort: "max",
          yoloMode: true,
          contextWindow: 123_456,
          maxTurns: 77,
          userContextHooks: [
            {
              id: "hook-1",
              event: "run_started",
              title: "Profile",
              content: "先看用户偏好。",
              enabled: true
            },
            {
              id: "hook-subagent",
              event: "run_started",
              behavior: "subagent",
              waitMode: "unblocking",
              maxTurns: 123,
              title: "Background",
              content: "先整理背景。",
              enabled: true
            }
          ],
          debugConversationView: true,
          userCustomPrompt: "先确认用户上下文，再回答。"
        })
      }
    );

    expect(updateResponse.status).toBe(200);
    const updatePayload = (await updateResponse.json()) as {
      settings: {
        debugConversationView: boolean;
        userCustomPrompt: string;
        userContextHooks: Array<{ id: string; maxTurns?: number }>;
      };
      permissionTools: Array<{ name: string }>;
    };
    expect(updatePayload.settings.debugConversationView).toBe(true);
    expect(updatePayload.settings.userCustomPrompt).toBe(
      "先确认用户上下文，再回答。"
    );
    expect(updatePayload.settings.userContextHooks).toEqual([
      expect.objectContaining({ id: "hook-1" }),
      expect.objectContaining({ id: "hook-subagent", maxTurns: 123 })
    ]);
    expect(updatePayload.permissionTools.length).toBeGreaterThan(0);

    const session = await createSession(app, {
      userId: "stage5-settings-user"
    });

    expect(session.workingDirectory).toBe(
      resolveApiWorkingDirectory(workspaceRoot, "apps/web")
    );
    expect(session.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(session.context.thinkingEffort).toBe("max");
    expect(session.context.yoloMode).toBe(true);
    expect(session.contextWindow).toBe(123_456);
    expect(session.maxTurns).toBe(77);
  });

  test("accepts a default working directory outside the repo root", async () => {
    const { app } = await createTestApp();
    const externalDirectory = "/tmp/my-agent-proj-external-workspace";

    const updateResponse = await app.request(
      "/users/stage5-external-workspace-user/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDirectory: externalDirectory
        })
      }
    );

    expect(updateResponse.status).toBe(200);
    const updatePayload = (await updateResponse.json()) as {
      settings: { workingDirectory: string };
    };
    expect(updatePayload.settings.workingDirectory).toBe(externalDirectory);

    const session = await createSession(app, {
      userId: "stage5-external-workspace-user"
    });

    expect(session.workingDirectory).toBe(externalDirectory);
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
    expect(
      payload.permissionTools.some((tool) => tool.name === "lsp_hover")
    ).toBe(true);
  });

  test("returns MCP server statuses and child tool enabled state", async () => {
    const { app } = await createTestApp();
    const workingDirectory = await mkdtemp(
      path.join(os.tmpdir(), "api-settings-mcp-")
    );
    const fixtureScript = path.resolve(
      import.meta.dir,
      "../../../packages/agent/tests/fixtures/mcp-echo-stdio.ts"
    );

    try {
      const settingsResponse = await app.request(
        "/users/stage5-mcp-user/settings",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workingDirectory })
        }
      );
      expect(settingsResponse.status).toBe(200);

      const updateResponse = await app.request(
        "/users/stage5-mcp-user/settings/mcp",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            servers: [
              {
                name: "local_echo",
                transport: "stdio",
                enabled: true,
                disabledTools: ["echo"],
                command: process.execPath,
                args: [fixtureScript]
              }
            ]
          })
        }
      );
      expect(updateResponse.status).toBe(200);
      const payload = userSettingsMcpPayloadSchema.parse(
        await updateResponse.json()
      );

      expect(payload.servers[0]?.disabledTools).toEqual(["echo"]);
      expect(payload.serverStatuses[0]).toMatchObject({
        name: "local_echo",
        status: "loaded",
        toolNames: [],
        tools: [{ name: "echo", enabled: false }]
      });
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
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

  test("updates the current session thinking effort through session settings", async () => {
    const { app } = await createTestApp();

    const session = await createSession(app, {
      userId: "stage5-thinking-effort-user",
      model: DEFAULT_DEEPSEEK_MODEL
    });

    const response = await app.request(
      `/sessions/${session.sessionId}/settings`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thinkingEffort: "max"
        })
      }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session: SessionSnapshot;
    };

    expect(payload.session.context.thinkingEffort).toBe("max");
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

  test("clears all session history in one request", async () => {
    const { app, sessionManager } = await createTestApp();

    const parentSession = await createSession(app, {
      userId: "stage5-clear-history-user"
    });
    const childSession = await createSession(app, {
      userId: "stage5-clear-history-user"
    });

    const childSnapshot = await sessionManager.getSession(
      childSession.sessionId
    );
    expect(childSnapshot).not.toBeNull();
    await sessionManager.saveSession({
      ...childSnapshot!,
      parentSessionId: parentSession.sessionId
    });
    await sessionManager.saveSession(parentSession);

    const response = await app.request("/sessions/history", {
      method: "DELETE"
    });
    expect(response.status).toBe(204);

    const listResponse = await app.request("/sessions");
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      sessions: SessionSnapshot[];
    };
    expect(listPayload.sessions).toHaveLength(0);
  });
});
