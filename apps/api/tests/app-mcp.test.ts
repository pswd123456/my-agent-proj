import { describe, expect, test } from "bun:test";

import type { AgentRuntime, RunEventSink, SessionSnapshot } from "@ai-app-template/agent";
import {
  FileSystemLogManager,
  createLogger,
  createMemorySessionManager
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiApp } from "../src/app.js";
import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

async function createRuntimeTestApp() {
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();
  const traceEvents: Array<{ sessionId: string; event: unknown }> = [];
  const logDir = await mkdtemp(path.join(os.tmpdir(), "api-mcp-log-"));
  const systemLogManager = new FileSystemLogManager(logDir, {
    maxBytes: 4096,
    maxFiles: 2
  });
  const apiLogger = createLogger({
    manager: systemLogManager,
    component: "api"
  });
  const runtimeCalls: string[] = [];
  const disposedSessionIds: string[] = [];

  const app = createApiApp({
    sessionManager,
    routineRepository,
    settingsRepository,
    traceManager: {
      async appendEvent(sessionId, event) {
        traceEvents.push({ sessionId, event });
      },
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
    defaultModel: "MiniMax-M2.7",
    async runtimeFactory(session) {
      return {
        runtime: {
          async run(input: {
            sessionId: string;
            eventSink?: RunEventSink;
          }) {
            runtimeCalls.push(input.sessionId);
            await input.eventSink?.({
              kind: "run_complete",
              sessionId: input.sessionId,
              createdAt: new Date().toISOString(),
              finalAnswer: "done",
              status: "completed",
              stopReason: "end_turn",
              toolCallCount: 0,
              toolResultCount: 0,
              toolOutputs: [],
              session
            });
            return {
              session,
              finalAnswer: "done",
              status: "completed" as const,
              stopReason: "end_turn",
              toolCallCount: 0,
              toolResultCount: 0,
              toolOutputs: []
            };
          }
        } as AgentRuntime,
        async dispose() {
          disposedSessionIds.push(session.sessionId);
        },
        preRunTraceEvent: {
          kind: "mcp_loaded",
          turnCount: 1,
          configPath: path.join(session.workingDirectory, ".agent/.config.toml"),
          foundConfig: true,
          diagnostics: [],
          servers: []
        }
      };
    }
  });

  return {
    app,
    sessionManager,
    traceEvents,
    runtimeCalls,
    disposedSessionIds
  };
}

async function createSession(
  app: Awaited<ReturnType<typeof createRuntimeTestApp>>["app"]
): Promise<SessionSnapshot> {
  const response = await app.request("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "mcp-api-user" })
  });

  expect(response.status).toBe(201);
  const payload = (await response.json()) as { session: SessionSnapshot };
  return payload.session;
}

describe("createApiApp MCP runtime assembly", () => {
  test("emits pre-run MCP trace and disposes runtime handle for execute", async () => {
    const { app, traceEvents, runtimeCalls, disposedSessionIds } =
      await createRuntimeTestApp();
    const session = await createSession(app);

    const response = await app.request(`/sessions/${session.sessionId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "run" })
    });

    expect(response.status).toBe(200);
    expect(runtimeCalls).toEqual([session.sessionId]);
    expect(disposedSessionIds).toEqual([session.sessionId]);
    expect(traceEvents).toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        event: expect.objectContaining({
          kind: "mcp_loaded",
          foundConfig: true
        })
      })
    ]);
  });

  test("streams pre-run MCP trace before runtime events and disposes afterwards", async () => {
    const { app, disposedSessionIds } = await createRuntimeTestApp();
    const session = await createSession(app);

    const response = await app.request(
      `/sessions/${session.sessionId}/execute/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "stream" })
      }
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("event: mcp_loaded");
    expect(body).toContain("event: run_complete");
    expect(disposedSessionIds).toEqual([session.sessionId]);
  });
});
