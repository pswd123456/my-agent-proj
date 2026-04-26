import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createFileSessionManager,
  createMemorySessionManager
} from "../src/session/index.js";

async function assertSessionManagerPersistsCompactionState(input: {
  kind: "memory" | "file";
  baseDirectory?: string;
}) {
  const sessionManager =
    input.kind === "memory"
      ? createMemorySessionManager()
      : createFileSessionManager(input.baseDirectory ?? process.cwd());

  const session = await sessionManager.createSession({
    workingDirectory: "/tmp/workspace",
    userId: `${input.kind}-user`
  });

  const saved = await sessionManager.saveSession({
    ...session,
    context: {
      ...session.context,
      fullCompactionState: {
        summaryMarkdown: "## Goal\nContinue from compacted history.",
        compactedAt: "2026-04-26T00:00:00.000Z",
        promptVersion: "full-compaction-v1",
        sourceBlockCount: 15,
        retainedTailCount: 6
      }
    },
    sessionState: {
      ...session.sessionState,
      historyCompactionsSinceFullCompaction: 1
    }
  });

  const reloaded = await sessionManager.getSession(saved.sessionId);
  expect(reloaded?.context.fullCompactionState).toEqual(
    saved.context.fullCompactionState
  );
  expect(reloaded?.sessionState.historyCompactionsSinceFullCompaction).toBe(1);
}

describe("session full compaction state persistence", () => {
  test("memory session manager preserves full compaction fields", async () => {
    await assertSessionManagerPersistsCompactionState({ kind: "memory" });
  });

  test("file session manager preserves full compaction fields", async () => {
    const baseDirectory = await mkdtemp(
      path.join(tmpdir(), "file-session-compaction-")
    );

    try {
      await assertSessionManagerPersistsCompactionState({
        kind: "file",
        baseDirectory
      });
    } finally {
      await rm(baseDirectory, { recursive: true, force: true });
    }
  });
});
