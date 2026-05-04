import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FileSystemLogManager,
  createLogger,
  workspaceFileSearchResultSchema,
  workspaceSkillSearchResultSchema
} from "@ai-app-template/agent";
import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createTestSettingsConfigStore } from "./helpers/settings-config-store.js";
import { createApiApp } from "../src/app.js";

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "composer-search-"));
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "docs"), { recursive: true });
  await mkdir(path.join(workspace, ".agents", "skills", "repo-reader"), {
    recursive: true
  });
  await mkdir(path.join(workspace, ".agents", "skills", "planner"), {
    recursive: true
  });
  await writeFile(
    path.join(workspace, "src", "app.ts"),
    "export {};\n",
    "utf8"
  );
  await writeFile(
    path.join(workspace, "src", "app-shell.ts"),
    "export {};\n",
    "utf8"
  );
  await writeFile(
    path.join(workspace, "docs", "app-guide.md"),
    "# app guide\n",
    "utf8"
  );
  await writeFile(
    path.join(workspace, ".agents", "skills", "repo-reader", "SKILL.md"),
    [
      "---",
      "name: repo_reader",
      "description: Read repository structure before implementation.",
      "---"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(workspace, ".agents", "skills", "planner", "SKILL.md"),
    [
      "---",
      "name: planner",
      "description: Plan implementation work.",
      "---"
    ].join("\n"),
    "utf8"
  );
  return workspace;
}

async function createTestApp() {
  const sessionManager = await createPostgresTestSessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const { settingsConfigStore } = await createTestSettingsConfigStore();
  const systemLogManager = new FileSystemLogManager(
    "/tmp/my-agent-proj-composer-search-test"
  );

  return {
    sessionManager,
    app: createApiApp({
      sessionManager,
      routineRepository,
      settingsConfigStore,
      traceManager: {
        async appendEvent() {},
        async readEvents() {
          return [];
        },
        async deleteEvents() {},
        async truncateEventsAfterTurn() {}
      },
      systemLogManager,
      apiLogger: createLogger({
        manager: systemLogManager,
        component: "api"
      }),
      buildWorkingDirectory(input) {
        return input ?? process.cwd();
      }
    })
  };
}

describe("composer search endpoints", () => {
  test("searches sessions by session id and user or assistant text", async () => {
    const { app, sessionManager } = await createTestApp();
    const sessionA = await sessionManager.createSession();
    const sessionB = await sessionManager.createSession();

    await sessionManager.appendBlock(sessionA.sessionId, {
      id: "user-1",
      kind: "user",
      content: "请帮我检查 runtime trace",
      createdAt: "2026-05-01T00:00:00.000Z"
    });
    await sessionManager.appendBlock(sessionB.sessionId, {
      id: "assistant-1",
      kind: "assistant",
      content: "我已经整理好了数据库迁移结论",
      createdAt: "2026-05-01T00:00:01.000Z"
    });

    const userResponse = await app.request("/sessions/search?q=runtime");
    expect(userResponse.status).toBe(200);
    const userPayload = (await userResponse.json()) as {
      sessions: Array<{ sessionId: string }>;
    };
    expect(userPayload.sessions.map((session) => session.sessionId)).toEqual([
      sessionA.sessionId
    ]);

    const assistantResponse = await app.request("/sessions/search?q=数据库迁移");
    expect(assistantResponse.status).toBe(200);
    const assistantPayload = (await assistantResponse.json()) as {
      sessions: Array<{ sessionId: string }>;
    };
    expect(
      assistantPayload.sessions.map((session) => session.sessionId)
    ).toEqual([sessionB.sessionId]);

    const idResponse = await app.request(
      `/sessions/search?q=${sessionB.sessionId.slice(0, 8)}`
    );
    expect(idResponse.status).toBe(200);
    const idPayload = (await idResponse.json()) as {
      sessions: Array<{ sessionId: string }>;
    };
    expect(idPayload.sessions.map((session) => session.sessionId)).toEqual([
      sessionB.sessionId
    ]);
  });

  test("searches session workspace files with stable ordering", async () => {
    const workspace = await createWorkspace();
    const { app, sessionManager } = await createTestApp();
    const session = await sessionManager.createSession({
      workingDirectory: workspace
    });

    const response = await app.request(
      `/sessions/${session.sessionId}/workspace-files/search?q=app&limit=8`
    );

    expect(response.status).toBe(200);
    const payload = workspaceFileSearchResultSchema.parse(
      await response.json()
    );
    expect(payload.truncated).toBe(false);
    expect(payload.items.map((item) => item.path)).toEqual([
      "src/app.ts",
      "src/app-shell.ts",
      "docs/app-guide.md"
    ]);
  });

  test("returns current skills for empty query and filters by partial match", async () => {
    const workspace = await createWorkspace();
    const { app, sessionManager } = await createTestApp();
    const session = await sessionManager.createSession({
      workingDirectory: workspace
    });

    const listResponse = await app.request(
      `/sessions/${session.sessionId}/skills/search?q=&limit=8`
    );
    expect(listResponse.status).toBe(200);
    const listPayload = workspaceSkillSearchResultSchema.parse(
      await listResponse.json()
    );
    expect(listPayload.truncated).toBe(false);
    expect(listPayload.items.map((item) => item.name)).toEqual([
      "planner",
      "repo_reader"
    ]);

    const filterResponse = await app.request(
      `/sessions/${session.sessionId}/skills/search?q=repo&limit=8`
    );
    expect(filterResponse.status).toBe(200);
    const filterPayload = workspaceSkillSearchResultSchema.parse(
      await filterResponse.json()
    );
    expect(filterPayload.items.map((item) => item.name)).toEqual([
      "repo_reader"
    ]);
  });
});
