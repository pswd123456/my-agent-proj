import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FileSystemLogManager,
  createLogger
} from "../src/system-log.js";

describe("system log manager", () => {
  test("writes structured records and truncates large details", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "agent-log-"));
    const manager = new FileSystemLogManager(baseDir, { maxBytes: 4096, maxFiles: 2 });
    const logger = createLogger({
      manager,
      component: "runtime",
      context: { sessionId: "session-1", turnCount: 3, runId: "run-1" }
    });

    await logger.info("test_event", {
      longText: "x".repeat(1000),
      nested: { ok: true }
    });

    const raw = await readFile(path.join(baseDir, "logs", "system.log.jsonl"), "utf8");
    const record = JSON.parse(raw.trim());
    expect(record.component).toBe("runtime");
    expect(record.sessionId).toBe("session-1");
    expect(record.turnCount).toBe(3);
    expect(record.runId).toBe("run-1");
    expect(String(record.details.longText).length).toBeLessThan(700);
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
    const runtimeLogger = createLogger({ manager, component: "runtime" });
    const apiLogger = createLogger({ manager, component: "api" });

    await runtimeLogger.info("r1", { step: 1 });
    await apiLogger.warn("a1", { step: 2 });
    await runtimeLogger.info("r2", { step: 3 });

    const firstPage = await manager.query({ component: "runtime", limit: 1 });
    expect(firstPage.records).toHaveLength(1);
    expect(firstPage.records[0]?.component).toBe("runtime");
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await manager.query({
      component: "runtime",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(secondPage.records).toHaveLength(1);
    expect(secondPage.records[0]?.event).not.toBe(firstPage.records[0]?.event);
  });
});
