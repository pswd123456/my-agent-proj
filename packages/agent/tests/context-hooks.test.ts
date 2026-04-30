import { describe, expect, test } from "bun:test";

import { resolveUserContextHookSections } from "../src/context-hooks.js";

describe("resolveUserContextHookSections", () => {
  test("includes session_started hooks only on the first run of a session", () => {
    const firstRunSections = resolveUserContextHookSections({
      hooks: [
        {
          id: "hook-1",
          event: "session_started",
          title: "Session intro",
          content: "先用这条上下文建立本会话基线。",
          enabled: true
        },
        {
          id: "hook-2",
          event: "run_started",
          title: "Run intro",
          content: "每次 run 都提醒一次。",
          enabled: true
        },
        {
          id: "hook-3",
          event: "run_end",
          title: "Wrap up",
          content: "结尾给出 next step。",
          enabled: true
        }
      ],
      session: {
        sessionState: {
          loopState: "waiting for input",
          turnCount: 0,
          lastError: null,
          pendingToolCallIds: [],
          interruptRequested: false,
          historyCompactionsSinceFullCompaction: 0
        }
      }
    });

    expect(firstRunSections.map((section) => section.event)).toEqual([
      "session_started",
      "run_started",
      "run_end"
    ]);

    const laterRunSections = resolveUserContextHookSections({
      hooks: [
        {
          id: "hook-1",
          event: "session_started",
          title: "Session intro",
          content: "先用这条上下文建立本会话基线。",
          enabled: true
        },
        {
          id: "hook-2",
          event: "run_started",
          title: "Run intro",
          content: "每次 run 都提醒一次。",
          enabled: true
        }
      ],
      session: {
        sessionState: {
          loopState: "waiting for input",
          turnCount: 3,
          lastError: null,
          pendingToolCallIds: [],
          interruptRequested: false,
          historyCompactionsSinceFullCompaction: 0
        }
      }
    });

    expect(laterRunSections.map((section) => section.event)).toEqual([
      "run_started"
    ]);
  });
});
