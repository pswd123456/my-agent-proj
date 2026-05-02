import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileTraceManager } from "../src/trace.js";

describe("FileTraceManager", () => {
  test("truncates events at and after the cutoff turn", async () => {
    const traceDir = await mkdtemp(path.join(os.tmpdir(), "trace-manager-"));
    const traceManager = createFileTraceManager(traceDir);
    const sessionId = "trace-session";

    await traceManager.appendEvent(sessionId, {
      kind: "response",
      turnCount: 1,
      stopReason: "end_turn",
      usage: {
        inputTokens: 11,
        outputTokens: 3,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      },
      content: []
    });
    await traceManager.appendEvent(sessionId, {
      kind: "tool_call",
      turnCount: 2,
      toolCallId: "tool-2",
      toolName: "read_file",
      input: { path: "apps/api/src/app.ts" }
    });
    await traceManager.appendEvent(sessionId, {
      kind: "response",
      turnCount: 2,
      stopReason: "end_turn",
      usage: {
        inputTokens: 17,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      },
      content: []
    });

    await traceManager.truncateEventsAfterTurn(sessionId, 2);

    const retained = await traceManager.readEvents(sessionId);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.event.kind).toBe("response");
    expect(retained[0]?.event.turnCount).toBe(1);
  });

  test("persists optional runId metadata on new trace records", async () => {
    const traceDir = await mkdtemp(path.join(os.tmpdir(), "trace-manager-"));
    const traceManager = createFileTraceManager(traceDir);
    const sessionId = "trace-run-id-session";

    await traceManager.appendEvent(
      sessionId,
      {
        kind: "turn_start",
        turnCount: 1,
        session: {
          sessionId,
          workingDirectory: "/tmp/workspace",
          model: "MiniMax-M2.7",
          sessionState: {
            loopState: "running",
            turnCount: 0,
            lastError: null,
            pendingToolCallIds: [],
            interruptRequested: false
          }
        }
      },
      { runId: "run-123" }
    );

    const retained = await traceManager.readEvents(sessionId);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.runId).toBe("run-123");
  });

  test("reads legacy trace records that do not have runId", async () => {
    const traceDir = await mkdtemp(path.join(os.tmpdir(), "trace-manager-"));
    const traceManager = createFileTraceManager(traceDir);
    const sessionId = "legacy-trace-session";
    const tracePath = path.join(traceDir, "sessions", `${sessionId}.trace.jsonl`);

    await mkdir(path.dirname(tracePath), { recursive: true });
    await writeFile(
      tracePath,
      `${JSON.stringify({
        sessionId,
        createdAt: "2026-05-02T00:00:00.000Z",
        event: {
          kind: "response",
          turnCount: 1,
          stopReason: "end_turn",
          usage: {
            inputTokens: 3,
            outputTokens: 2,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0
          },
          content: []
        }
      })}\n`,
      "utf8"
    );

    const retained = await traceManager.readEvents(sessionId);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.runId).toBeUndefined();
    expect(retained[0]?.event.kind).toBe("response");

    const raw = await readFile(tracePath, "utf8");
    expect(raw).toContain("\"sessionId\":\"legacy-trace-session\"");
  });
});
