import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FileSystemLogManager,
  createLogger
} from "../src/system-log.js";

describe("system log manager", () => {
  test("writes structured records and preserves both ends of truncated details", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "agent-log-"));
    const manager = new FileSystemLogManager(baseDir, { maxBytes: 4096, maxFiles: 2 });
    const logger = createLogger({
      manager,
      component: "runtime",
      context: {
        sessionId: "session-1",
        turnCount: 3,
        runId: "run-1",
        requestId: "req-1"
      }
    });
    const longText = `${"start-".repeat(40)}${"middle-".repeat(80)}${"end-".repeat(40)}`;

    await logger.info("test_event", {
      longText,
      longArray: Array.from({ length: 25 }, (_, index) => `value-${index}`),
      nested: { ok: true }
    });

    const raw = await readFile(path.join(baseDir, "logs", "system.log.jsonl"), "utf8");
    const record = JSON.parse(raw.trim());
    expect(record.component).toBe("runtime");
    expect(record.sessionId).toBe("session-1");
    expect(record.turnCount).toBe(3);
    expect(record.runId).toBe("run-1");
    expect(record.requestId).toBe("req-1");
    expect(String(record.details.longText)).toContain("...[truncated ");
    expect(String(record.details.longText)).toContain(longText.slice(0, 80));
    expect(String(record.details.longText)).toContain(longText.slice(-80));
    expect(record.details.longArray).toEqual([
      "value-0",
      "value-1",
      "value-2",
      "value-3",
      "value-4",
      "value-5",
      "value-6",
      "value-7",
      "value-8",
      "value-9",
      "[truncated 5 items]",
      "value-15",
      "value-16",
      "value-17",
      "value-18",
      "value-19",
      "value-20",
      "value-21",
      "value-22",
      "value-23",
      "value-24"
    ]);
  });

  test("rotates log files when max bytes exceeded", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "agent-log-"));
    const manager = new FileSystemLogManager(baseDir, { maxBytes: 300, maxFiles: 2 });
    const logger = createLogger({ manager, component: "runtime" });

    for (let index = 0; index < 10; index += 1) {
      await logger.info("rotate", { index, text: "y".repeat(200) });
    }

    const entries = await readdir(path.join(baseDir, "logs"));
    expect(entries.some((entry) => entry === "system.log.jsonl")).toBe(true);
    expect(entries.some((entry) => entry === "system.log.jsonl.1")).toBe(true);
    expect(entries.some((entry) => entry === "system.log.jsonl.2")).toBe(true);
    expect(entries.some((entry) => entry === "system.log.jsonl.3")).toBe(false);
  });

  test("queries latest records with filters and cursor", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "agent-log-"));
    const manager = new FileSystemLogManager(baseDir, { maxBytes: 4096, maxFiles: 2 });
    await manager.append({
      timestamp: "2026-05-02T00:00:00.000Z",
      level: "info",
      component: "runtime",
      event: "r1",
      sessionId: "session-a",
      runId: "run-a",
      requestId: "req-a",
      details: { step: 1 }
    });
    await manager.append({
      timestamp: "2026-05-02T00:00:01.000Z",
      level: "warn",
      component: "api",
      event: "a1",
      sessionId: "session-a",
      runId: "run-b",
      requestId: "req-b",
      details: { step: 2 }
    });
    await manager.append({
      timestamp: "2026-05-02T00:00:02.000Z",
      level: "info",
      component: "worker",
      event: "w1",
      sessionId: "session-a",
      runId: "run-b",
      requestId: "req-c",
      details: { step: 3 }
    });
    await manager.append({
      timestamp: "2026-05-02T00:00:03.000Z",
      level: "info",
      component: "worker",
      event: "w2",
      sessionId: "session-b",
      runId: "run-b",
      requestId: "req-c",
      details: { step: 4 }
    });

    const firstPage = await manager.query({
      component: "worker",
      runId: "run-b",
      requestId: "req-c",
      limit: 1
    });
    expect(firstPage.records).toHaveLength(1);
    expect(firstPage.records[0]?.component).toBe("worker");
    expect(firstPage.records[0]?.event).toBe("w2");
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await manager.query({
      component: "worker",
      runId: "run-b",
      requestId: "req-c",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(secondPage.records).toHaveLength(1);
    expect(secondPage.records[0]?.event).toBe("w1");
    expect(secondPage.nextCursor).toBeNull();
  });
});
