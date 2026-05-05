import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { createAgentRuntime } from "../src/runtime.js";
import type {
  TraceAppendOptions,
  TraceEvent,
  TraceManager,
  TraceRecord
} from "../src/trace.js";
import { ToolRegistry } from "../src/tools/registry.js";

class MemoryRecordTraceManager implements TraceManager {
  readonly records: TraceRecord[] = [];
  private counter = 0;

  async appendEvent(
    sessionId: string,
    event: TraceEvent,
    options?: TraceAppendOptions
  ): Promise<void> {
    this.records.push({
      sessionId,
      createdAt: new Date(this.counter++ * 1_000).toISOString(),
      ...(options?.runId ? { runId: options.runId } : {}),
      event: structuredClone(event)
    });
  }

  async readEvents(_sessionId: string): Promise<TraceRecord[]> {
    return this.records.map((record) => structuredClone(record));
  }

  async deleteEvents(_sessionId: string): Promise<void> {
    this.records.length = 0;
  }

  async truncateEventsAfterTurn(_sessionId: string, turnCount: number) {
    const retained = this.records.filter(
      (record) => record.event.turnCount < turnCount
    );
    this.records.splice(0, this.records.length, ...retained);
  }
}

describe("runtime trace run correlation", () => {
  test("assigns one runId to every trace event emitted by a runtime.run call", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const traceManager = new MemoryRecordTraceManager();
    let replyCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            replyCount += 1;
            return {
              content: [{ type: "text" as const, text: `reply ${replyCount}` }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 12,
                output_tokens: 4,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository: createMemoryRoutineRepository(),
      toolRegistry: new ToolRegistry(),
      traceManager
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/runtime-trace-correlation",
      userId: "trace-run-user"
    });

    await runtime.run({
      sessionId: session.sessionId,
      message: "first run"
    });
    await runtime.run({
      sessionId: session.sessionId,
      message: "second run"
    });

    expect(replyCount).toBe(2);
    expect(traceManager.records.length).toBeGreaterThan(0);
    expect(
      traceManager.records.every((record) => typeof record.runId === "string")
    ).toBe(true);

    const turnStarts = traceManager.records.filter(
      (
        record
      ): record is TraceRecord & {
        runId: string;
        event: Extract<TraceEvent, { kind: "turn_start" }>;
      } =>
        record.event.kind === "turn_start" && typeof record.runId === "string"
    );
    expect(turnStarts).toHaveLength(2);
    expect(turnStarts.map((record) => record.event.turnCount)).toEqual([1, 1]);

    const distinctRunIds = [
      ...new Set(turnStarts.map((record) => record.runId))
    ];
    expect(distinctRunIds).toHaveLength(2);

    for (const runId of distinctRunIds) {
      const runRecords = traceManager.records.filter(
        (record) => record.runId === runId
      );
      expect(runRecords.length).toBeGreaterThan(0);
      expect(
        runRecords.some((record) => record.event.kind === "turn_start")
      ).toBe(true);
      expect(
        runRecords.some((record) => record.event.kind === "turn_end")
      ).toBe(true);
    }
  });

  test("uses caller-provided runId for runtime trace correlation", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const traceManager = new MemoryRecordTraceManager();

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            return {
              content: [{ type: "text" as const, text: "reply" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 12,
                output_tokens: 4,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository: createMemoryRoutineRepository(),
      toolRegistry: new ToolRegistry(),
      traceManager
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/runtime-trace-correlation",
      userId: "trace-run-user"
    });

    await runtime.run({
      sessionId: session.sessionId,
      runId: "api-run-1",
      message: "run"
    });

    expect(traceManager.records.length).toBeGreaterThan(0);
    expect(
      traceManager.records.every((record) => record.runId === "api-run-1")
    ).toBe(true);
  });
});
