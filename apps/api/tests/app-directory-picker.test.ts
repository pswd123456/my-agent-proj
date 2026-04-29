import { describe, expect, test } from "bun:test";

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

async function createTestApp(options?: {
  pickDirectory?: (input?: { startDirectory?: string }) => Promise<string | null>;
}) {
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();
  const systemLogManager = new FileSystemLogManager(
    "/tmp/my-agent-proj-directory-picker-test"
  );

  return createApiApp({
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
    },
    ...(options?.pickDirectory ? { pickDirectory: options.pickDirectory } : {})
  });
}

describe("createApiApp directory picker", () => {
  test("returns the selected directory path", async () => {
    const app = await createTestApp({
      async pickDirectory(input) {
        expect(input?.startDirectory).toBe("/tmp/start-here");
        return "/tmp/chosen-directory";
      }
    });

    const response = await app.request("/directory-picker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDirectory: "/tmp/start-here"
      })
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      path: string | null;
      canceled: boolean;
    };
    expect(payload).toEqual({
      path: "/tmp/chosen-directory",
      canceled: false
    });
  });

  test("treats user cancel as a non-error result", async () => {
    const app = await createTestApp({
      async pickDirectory() {
        return null;
      }
    });

    const response = await app.request("/directory-picker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      path: string | null;
      canceled: boolean;
    };
    expect(payload).toEqual({
      path: null,
      canceled: true
    });
  });

  test("returns 501 when no directory picker is configured", async () => {
    const app = await createTestApp();

    const response = await app.request("/directory-picker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(501);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("Directory picker is not configured.");
  });
});
