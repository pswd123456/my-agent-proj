import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
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
});
