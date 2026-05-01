import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

function runGit(args: string[], cwd: string) {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore"
  });
}

async function createGitWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "git-status-api-"));
  runGit(["init", "-b", "main"], workspace);

  await writeFile(path.join(workspace, "tracked.txt"), "base\n", "utf8");
  runGit(["add", "tracked.txt"], workspace);
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Codex",
      "-c",
      "user.email=codex@example.com",
      "commit",
      "-m",
      "init"
    ],
    {
      cwd: workspace,
      stdio: "ignore"
    }
  );

  await writeFile(
    path.join(workspace, "tracked.txt"),
    "base\nedited\n",
    "utf8"
  );
  await writeFile(path.join(workspace, "staged.txt"), "staged\n", "utf8");
  runGit(["add", "staged.txt"], workspace);
  await writeFile(path.join(workspace, "untracked.txt"), "untracked\n", "utf8");

  return workspace;
}

async function createPlainWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "git-status-plain-"));
}

async function createTestApp() {
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();
  const systemLogManager = new FileSystemLogManager(
    "/tmp/my-agent-proj-git-status-test"
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

describe("session git status API", () => {
  test("returns aggregated git change counts for the current workspace", async () => {
    const workspace = await createGitWorkspace();

    try {
      const { app, sessionManager } = await createTestApp();
      const session = await sessionManager.createSession({
        workingDirectory: workspace,
        userId: "user-a"
      });

      const response = await app.request(
        `/sessions/${session.sessionId}/git-status`
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        code: string;
        branch: string | null;
        clean: boolean | null;
        changedPathCount: number;
        stagedPathCount: number;
        unstagedPathCount: number;
        untrackedPathCount: number;
        addedLineCount: number;
        removedLineCount: number;
      };

      expect(payload.ok).toBe(true);
      expect(payload.code).toBe("GIT_STATUS_OK");
      expect(payload.branch).toContain("main");
      expect(payload.clean).toBe(false);
      expect(payload.changedPathCount).toBe(3);
      expect(payload.stagedPathCount).toBe(1);
      expect(payload.unstagedPathCount).toBe(1);
      expect(payload.untrackedPathCount).toBe(1);
      expect(payload.addedLineCount).toBe(3);
      expect(payload.removedLineCount).toBe(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("reports a non-repository workspace without failing the request", async () => {
    const workspace = await createPlainWorkspace();

    try {
      const { app, sessionManager } = await createTestApp();
      const session = await sessionManager.createSession({
        workingDirectory: workspace,
        userId: "user-a"
      });

      const response = await app.request(
        `/sessions/${session.sessionId}/git-status`
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        code: string;
        clean: boolean | null;
      };

      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("NOT_GIT_REPOSITORY");
      expect(payload.clean).toBeNull();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
