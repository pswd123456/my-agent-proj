import { describe, expect, test } from "bun:test";

import {
  resolveUserContextHookSections,
  resolveUserContextMessageHooks
} from "../src/context-hooks.js";

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
          behavior: "context",
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
      "run_started"
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

  test("resolves message hooks for session, run start, and run end", () => {
    const session = {
      sessionState: {
        loopState: "waiting for input" as const,
        turnCount: 0,
        lastError: null,
        pendingToolCallIds: [],
        interruptRequested: false,
        historyCompactionsSinceFullCompaction: 0
      }
    };
    const hooks = [
      {
        id: "hook-1",
        event: "session_started" as const,
        behavior: "message" as const,
        title: "Session intro",
        content: "先执行会话启动消息。",
        enabled: true
      },
      {
        id: "hook-2",
        event: "run_started" as const,
        behavior: "message" as const,
        title: "Run intro",
        content: "先执行 run 启动消息。",
        enabled: true
      },
      {
        id: "hook-3",
        event: "run_end" as const,
        behavior: "message" as const,
        title: "Wrap up",
        content: "用户消息完成后执行。",
        enabled: true
      },
      {
        id: "hook-4",
        event: "run_started" as const,
        title: "Context",
        content: "只是 context。",
        enabled: true
      }
    ];

    expect(
      resolveUserContextMessageHooks({
        hooks,
        session,
        event: "session_started"
      }).map((hook) => hook.id)
    ).toEqual(["hook-1"]);
    expect(
      resolveUserContextMessageHooks({
        hooks,
        session,
        event: "run_started"
      }).map((hook) => hook.id)
    ).toEqual(["hook-2"]);
    expect(
      resolveUserContextMessageHooks({
        hooks,
        session,
        event: "run_end"
      }).map((hook) => hook.id)
    ).toEqual(["hook-3"]);
  });

  test("keeps only the first enabled hook for each runtime hook type", () => {
    const session = {
      sessionState: {
        loopState: "waiting for input" as const,
        turnCount: 0,
        lastError: null,
        pendingToolCallIds: [],
        interruptRequested: false,
        historyCompactionsSinceFullCompaction: 0
      }
    };
    const hooks = [
      {
        id: "hook-1",
        event: "run_started" as const,
        behavior: "context" as const,
        title: "Context A",
        content: "先读 A。",
        enabled: true
      },
      {
        id: "hook-2",
        event: "run_started" as const,
        behavior: "context" as const,
        title: "Context B",
        content: "先读 B。",
        enabled: true
      },
      {
        id: "hook-3",
        event: "run_started" as const,
        behavior: "message" as const,
        title: "Message A",
        content: "发送 A。",
        enabled: true
      },
      {
        id: "hook-4",
        event: "run_started" as const,
        behavior: "message" as const,
        title: "Message B",
        content: "发送 B。",
        enabled: true
      }
    ];

    expect(
      resolveUserContextHookSections({
        hooks,
        session
      }).flatMap((section) => section.hooks.map((hook) => hook.id))
    ).toEqual(["hook-1"]);
    expect(
      resolveUserContextMessageHooks({
        hooks,
        session,
        event: "run_started"
      }).map((hook) => hook.id)
    ).toEqual(["hook-3"]);
  });
});
