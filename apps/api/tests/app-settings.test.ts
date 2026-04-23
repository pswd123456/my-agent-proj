import { describe, expect, test } from "bun:test";

import { SESSION_MAX_TURNS_LIMIT } from "@ai-app-template/domain";
import type { SessionSnapshot } from "@ai-app-template/agent";
import { createMemorySessionManager } from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createApiApp } from "../src/app.js";
import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

function createTestApp() {
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();

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
      buildWorkingDirectory(input) {
        return resolveApiWorkingDirectory(workspaceRoot, input);
      },
      defaultModel: "MiniMax-M2.7"
    })
  };
}

async function createSession(
  app: ReturnType<typeof createTestApp>["app"],
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
    const { app } = createTestApp();

    const session = await createSession(app, {
      userId: "stage5-default-user"
    });

    expect(session.context.userId).toBe("stage5-default-user");
    expect(session.workingDirectory).toBe(
      resolveApiWorkingDirectory(workspaceRoot)
    );
    expect(session.context.yoloMode).toBe(false);
    expect(session.contextWindow).toBe(200_000);
    expect(session.maxTurns).toBe(50);
  });

  test("uses updated user settings for the next newly created session", async () => {
    const { app } = createTestApp();

    const updateResponse = await app.request(
      "/users/stage5-settings-user/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workingDirectory: "apps/web",
          yoloMode: true,
          contextWindow: 123_456,
          maxTurns: 77
        })
      }
    );

    expect(updateResponse.status).toBe(200);

    const session = await createSession(app, {
      userId: "stage5-settings-user"
    });

    expect(session.workingDirectory).toBe(
      resolveApiWorkingDirectory(workspaceRoot, "apps/web")
    );
    expect(session.context.yoloMode).toBe(true);
    expect(session.contextWindow).toBe(123_456);
    expect(session.maxTurns).toBe(77);
  });

  test("syncs normalized permission rules onto the current session", async () => {
    const { app } = createTestApp();

    const session = await createSession(app, {
      userId: "stage5-permission-user"
    });

    const response = await app.request(`/sessions/${session.sessionId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yoloMode: true,
        toolAllowList: ["read_file"],
        toolAskList: ["read_file", "write_file"],
        toolDenyList: ["delete_path"]
      })
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session: SessionSnapshot;
    };

    expect(payload.session.context.yoloMode).toBe(true);
    expect(payload.session.context.toolAllowList).toEqual(["read_file"]);
    expect(payload.session.context.toolAskList).toEqual(["write_file"]);
    expect(payload.session.context.toolDenyList).toEqual(["delete_path"]);
  });

  test("clamps persisted max turns to the shared session limit", async () => {
    const { app } = createTestApp();

    const updateResponse = await app.request("/users/stage5-limit-user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxTurns: SESSION_MAX_TURNS_LIMIT + 100
      })
    });

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
});
