import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FileSystemLogManager,
  createLogger,
  sessionFileChangeActionResultSchema
} from "@ai-app-template/agent";
import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createTestSettingsConfigStore } from "./helpers/settings-config-store.js";
import { createApiApp } from "../src/app.js";

async function createTestApp(workspaceRoot: string) {
  const sessionManager = await createPostgresTestSessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const { settingsConfigStore } = await createTestSettingsConfigStore();
  const logDir = await mkdtemp(path.join(os.tmpdir(), "api-file-changes-log-"));
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
      apiLogger,
      buildWorkingDirectory(input) {
        if (!input) {
          return workspaceRoot;
        }

        return path.isAbsolute(input)
          ? input
          : path.resolve(workspaceRoot, input);
      },
      defaultModel: "MiniMax-M2.7"
    })
  };
}

describe("createApiApp workspace file changes", () => {
  test("undoes and reapplies a run diff against the session workspace", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "api-file-changes-workspace-")
    );
    const { app } = await createTestApp(workspaceRoot);
    const createResponse = await app.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as {
      session: { sessionId: string; workingDirectory: string };
    };
    const sessionId = createPayload.session.sessionId;
    const filePath = path.join(
      createPayload.session.workingDirectory,
      "demo.txt"
    );
    await mkdir(createPayload.session.workingDirectory, { recursive: true });
    await writeFile(filePath, "alpha\ngamma\n", "utf8");

    const fileChange = {
      path: "demo.txt",
      action: "modify" as const,
      addedLineCount: 1,
      removedLineCount: 1,
      diff: [
        "--- a/demo.txt",
        "+++ b/demo.txt",
        "@@ -1,2 +1,2 @@",
        " alpha",
        "-beta",
        "+gamma"
      ].join("\n")
    };

    const undoResponse = await app.request(
      `/sessions/${sessionId}/file-changes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "undo",
          files: [fileChange]
        })
      }
    );

    expect(undoResponse.status).toBe(200);
    const undoPayload = sessionFileChangeActionResultSchema.parse(
      await undoResponse.json()
    );
    expect(undoPayload.files).toEqual([fileChange]);
    expect(await readFile(filePath, "utf8")).toBe("alpha\nbeta\n");

    const reapplyResponse = await app.request(
      `/sessions/${sessionId}/file-changes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reapply",
          files: [fileChange]
        })
      }
    );

    expect(reapplyResponse.status).toBe(200);
    const reapplyPayload = sessionFileChangeActionResultSchema.parse(
      await reapplyResponse.json()
    );
    expect(reapplyPayload.files).toEqual([fileChange]);
    expect(await readFile(filePath, "utf8")).toBe("alpha\ngamma\n");
  });

  test("restores and re-deletes files from delete diffs", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "api-file-delete-workspace-")
    );
    const { app } = await createTestApp(workspaceRoot);
    const createResponse = await app.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    expect(createResponse.status).toBe(201);
    const createPayload = (await createResponse.json()) as {
      session: { sessionId: string; workingDirectory: string };
    };
    const sessionId = createPayload.session.sessionId;
    const filePath = path.join(
      createPayload.session.workingDirectory,
      "deleted.txt"
    );
    await mkdir(createPayload.session.workingDirectory, { recursive: true });

    const fileChange = {
      path: "deleted.txt",
      action: "delete" as const,
      addedLineCount: 0,
      removedLineCount: 2,
      diff: [
        "--- a/deleted.txt",
        "+++ /dev/null",
        "@@ -1,2 +0,0 @@",
        "-alpha",
        "-beta"
      ].join("\n")
    };

    const undoResponse = await app.request(
      `/sessions/${sessionId}/file-changes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "undo",
          files: [fileChange]
        })
      }
    );

    expect(undoResponse.status).toBe(200);
    expect(await readFile(filePath, "utf8")).toBe("alpha\nbeta\n");

    const reapplyResponse = await app.request(
      `/sessions/${sessionId}/file-changes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reapply",
          files: [fileChange]
        })
      }
    );

    expect(reapplyResponse.status).toBe(200);
    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });
});
