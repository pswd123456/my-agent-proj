import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FileSystemLogManager,
  createLogger,
  createMemorySessionManager
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createApiApp } from "../src/app.js";

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "composer-search-"));
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "docs"), { recursive: true });
  await mkdir(path.join(workspace, ".agent", "skills", "repo-reader"), {
    recursive: true
  });
  await mkdir(path.join(workspace, ".agent", "skills", "planner"), {
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
    path.join(workspace, ".agent", "skills", "repo-reader", "SKILL.md"),
    [
      "---",
      "name: repo_reader",
      "description: Read repository structure before implementation.",
      "---"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(workspace, ".agent", "skills", "planner", "SKILL.md"),
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
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();
  const systemLogManager = new FileSystemLogManager(
    "/tmp/my-agent-proj-composer-search-test"
  );

  return {
    sessionManager,
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
  test("searches session workspace files with stable ordering", async () => {
    const workspace = await createWorkspace();
    const { app, sessionManager } = await createTestApp();
    const session = await sessionManager.createSession({
      workingDirectory: workspace,
      userId: "user-a"
    });

    const response = await app.request(
      `/sessions/${session.sessionId}/workspace-files/search?q=app&limit=8`
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: Array<{ path: string; name: string }>;
      truncated: boolean;
    };
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
      workingDirectory: workspace,
      userId: "user-a"
    });

    const listResponse = await app.request(
      `/sessions/${session.sessionId}/skills/search?q=&limit=8`
    );
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      items: Array<{ name: string }>;
      truncated: boolean;
    };
    expect(listPayload.truncated).toBe(false);
    expect(listPayload.items.map((item) => item.name)).toEqual([
      "planner",
      "repo_reader"
    ]);

    const filterResponse = await app.request(
      `/sessions/${session.sessionId}/skills/search?q=repo&limit=8`
    );
    expect(filterResponse.status).toBe(200);
    const filterPayload = (await filterResponse.json()) as {
      items: Array<{ name: string }>;
      truncated: boolean;
    };
    expect(filterPayload.items.map((item) => item.name)).toEqual([
      "repo_reader"
    ]);
  });
});
