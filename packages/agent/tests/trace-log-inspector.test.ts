import { describe, expect, test } from "bun:test";

import type { TraceRecord } from "../src/trace.js";
import {
  buildRunSummaries,
  buildTurnSummaries
} from "../../../scripts/trace-log-inspector.ts";

function createTurnStartRecord(input: {
  sessionId?: string;
  createdAt: string;
  turnCount: number;
  runId?: string;
}): TraceRecord {
  return {
    sessionId: input.sessionId ?? "trace-session",
    createdAt: input.createdAt,
    ...(input.runId ? { runId: input.runId } : {}),
    event: {
      kind: "turn_start",
      turnCount: input.turnCount,
      session: {
        sessionId: input.sessionId ?? "trace-session",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        sessionState: {
          loopState: "running",
          turnCount: Math.max(0, input.turnCount - 1),
          lastError: null,
          pendingToolCallIds: [],
          interruptRequested: false
        }
      }
    }
  };
}

function createTurnEndRecord(input: {
  sessionId?: string;
  createdAt: string;
  turnCount: number;
  runId?: string;
}): TraceRecord {
  return {
    sessionId: input.sessionId ?? "trace-session",
    createdAt: input.createdAt,
    ...(input.runId ? { runId: input.runId } : {}),
    event: {
      kind: "turn_end",
      turnCount: input.turnCount,
      loopState: "completed"
    }
  };
}

function createResponseRecord(input: {
  sessionId?: string;
  createdAt: string;
  turnCount: number;
  runId?: string;
}): TraceRecord {
  return {
    sessionId: input.sessionId ?? "trace-session",
    createdAt: input.createdAt,
    ...(input.runId ? { runId: input.runId } : {}),
    event: {
      kind: "response",
      turnCount: input.turnCount,
      stopReason: "end_turn",
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0
      },
      content: []
    }
  };
}

function createWorkspaceInstructionsRecord(input: {
  sessionId?: string;
  createdAt: string;
  turnCount: number;
  runId?: string;
}): TraceRecord {
  return {
    sessionId: input.sessionId ?? "trace-session",
    createdAt: input.createdAt,
    ...(input.runId ? { runId: input.runId } : {}),
    event: {
      kind: "workspace_instructions_loaded",
      turnCount: input.turnCount,
      instructions: null,
      diagnostics: []
    }
  };
}

describe("trace log inspector summaries", () => {
  test("groups records by runId before grouping turns", () => {
    const runs = buildRunSummaries([
      createTurnStartRecord({
        createdAt: "2026-05-02T00:00:00.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createResponseRecord({
        createdAt: "2026-05-02T00:00:01.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createTurnEndRecord({
        createdAt: "2026-05-02T00:00:02.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createTurnStartRecord({
        createdAt: "2026-05-02T00:01:00.000Z",
        turnCount: 1,
        runId: "run-b"
      }),
      createResponseRecord({
        createdAt: "2026-05-02T00:01:01.000Z",
        turnCount: 1,
        runId: "run-b"
      }),
      createTurnEndRecord({
        createdAt: "2026-05-02T00:01:02.000Z",
        turnCount: 1,
        runId: "run-b"
      })
    ]);

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.runId)).toEqual(["run-a", "run-b"]);
    expect(runs.map((run) => run.turns).flat().map((turn) => turn.turnCount)).toEqual([
      1,
      1
    ]);
  });

  test("keeps repeated recorded turn values separate when a new turn_start appears", () => {
    const turns = buildTurnSummaries([
      createTurnStartRecord({
        createdAt: "2026-05-02T00:00:00.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createResponseRecord({
        createdAt: "2026-05-02T00:00:01.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createTurnEndRecord({
        createdAt: "2026-05-02T00:00:02.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createTurnStartRecord({
        createdAt: "2026-05-02T00:00:03.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createResponseRecord({
        createdAt: "2026-05-02T00:00:04.000Z",
        turnCount: 1,
        runId: "run-a"
      }),
      createTurnEndRecord({
        createdAt: "2026-05-02T00:00:05.000Z",
        turnCount: 1,
        runId: "run-a"
      })
    ]);

    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.turnCount)).toEqual([1, 1]);
    expect(turns.map((turn) => turn.sequence)).toEqual([1, 2]);
  });

  test("keeps pre-turn runtime context events inside the following turn", () => {
    const turns = buildTurnSummaries([
      createWorkspaceInstructionsRecord({
        createdAt: "2026-05-02T00:00:00.000Z",
        turnCount: 1
      }),
      createTurnStartRecord({
        createdAt: "2026-05-02T00:00:01.000Z",
        turnCount: 1
      }),
      createResponseRecord({
        createdAt: "2026-05-02T00:00:02.000Z",
        turnCount: 1
      }),
      createTurnEndRecord({
        createdAt: "2026-05-02T00:00:03.000Z",
        turnCount: 1
      })
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.records).toHaveLength(4);
    expect(turns[0]?.startedAt).toBe("2026-05-02T00:00:01.000Z");
  });

  test("infers separate legacy runs when old traces restart at turn 1", () => {
    const runs = buildRunSummaries([
      createTurnStartRecord({
        createdAt: "2026-05-02T00:00:00.000Z",
        turnCount: 1
      }),
      createResponseRecord({
        createdAt: "2026-05-02T00:00:01.000Z",
        turnCount: 1
      }),
      createTurnEndRecord({
        createdAt: "2026-05-02T00:00:02.000Z",
        turnCount: 1
      }),
      createTurnStartRecord({
        createdAt: "2026-05-02T00:01:00.000Z",
        turnCount: 1
      }),
      createResponseRecord({
        createdAt: "2026-05-02T00:01:01.000Z",
        turnCount: 1
      }),
      createTurnEndRecord({
        createdAt: "2026-05-02T00:01:02.000Z",
        turnCount: 1
      })
    ]);

    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.isLegacy)).toBe(true);
    expect(runs.map((run) => run.turns)).toHaveLength(2);
  });
});
