import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import {
  createAgentRuntime,
  createFileTraceManager,
  type RunStreamEvent
} from "../src/index.js";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("runtime failure persistence", () => {
  test("persists failed status when the model run throws", async () => {
    const traceDir = await mkdtemp(path.join(os.tmpdir(), "runtime-failure-"));
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const traceManager = createFileTraceManager(traceDir);
    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            throw new Error("model stream failed");
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry(),
      traceManager
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "failure-user"
    });

    const streamEvents: RunStreamEvent[] = [];
    await expect(
      runtime.run({
        sessionId: session.sessionId,
        message: "触发一次失败",
        eventSink(event) {
          streamEvents.push(event);
        }
      })
    ).rejects.toThrow("model stream failed");

    const persisted = await sessionManager.getSession(session.sessionId);
    expect(persisted?.context.status).toBe("failed");
    expect(persisted?.sessionState.loopState).toBe("failed");
    expect(persisted?.sessionState.lastError).toBe("model stream failed");
    expect(persisted?.sessionState.pendingToolCallIds).toEqual([]);

    const streamRunError = streamEvents.find(
      (event): event is Extract<RunStreamEvent, { kind: "run_error"; session: unknown }> =>
        event.kind === "run_error" && "session" in event
    );
    expect(streamRunError?.session && typeof streamRunError.session === "object").toBe(
      true
    );

    const traceEvents = await traceManager.readEvents(session.sessionId);
    const traceRunError = traceEvents.find((record) => record.event.kind === "run_error")?.event;
    expect(traceRunError && "contextStatus" in traceRunError && traceRunError.contextStatus).toBe(
      "failed"
    );
    expect(traceRunError && "loopState" in traceRunError && traceRunError.loopState).toBe(
      "failed"
    );

    await rm(traceDir, { recursive: true, force: true });
  });
});
