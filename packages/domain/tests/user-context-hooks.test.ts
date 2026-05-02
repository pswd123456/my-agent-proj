import { describe, expect, test } from "bun:test";

import {
  getUserContextHookTypeKey,
  normalizeUserContextHooks
} from "../src/user-context-hooks.js";

describe("user context hooks", () => {
  test("allows only one enabled hook per behavior and event type", () => {
    expect(
      normalizeUserContextHooks([
        {
          id: "hook-1",
          event: "run_started",
          behavior: "context",
          title: "Context A",
          content: "先读上下文 A。",
          enabled: true
        },
        {
          id: "hook-2",
          event: "run_started",
          behavior: "context",
          title: "Context B",
          content: "先读上下文 B。",
          enabled: true
        },
        {
          id: "hook-3",
          event: "run_started",
          behavior: "message",
          title: "Message",
          content: "发送 run start 消息。",
          enabled: true
        }
      ])
    ).toEqual([
      {
        id: "hook-1",
        event: "run_started",
        behavior: "context",
        title: "Context A",
        content: "先读上下文 A。",
        enabled: true
      },
      {
        id: "hook-2",
        event: "run_started",
        behavior: "context",
        title: "Context B",
        content: "先读上下文 B。",
        enabled: false
      },
      {
        id: "hook-3",
        event: "run_started",
        behavior: "message",
        title: "Message",
        content: "发送 run start 消息。",
        enabled: true
      }
    ]);
  });

  test("infers the hook type key from legacy records without behavior", () => {
    expect(
      getUserContextHookTypeKey({
        event: "run_end"
      })
    ).toBe("message:run_end");
  });

  test("defaults subagent hooks to blocking wait mode and the shared turn budget", () => {
    expect(
      normalizeUserContextHooks([
        {
          id: "hook-subagent",
          event: "run_started",
          behavior: "subagent",
          title: "Background research",
          content: "先整理背景资料。",
          enabled: true
        }
      ])
    ).toEqual([
      {
        id: "hook-subagent",
        event: "run_started",
        behavior: "subagent",
        waitMode: "blocking",
        maxTurns: 100,
        title: "Background research",
        content: "先整理背景资料。",
        enabled: true
      }
    ]);
  });

  test("clamps subagent hook max turns to the shared limit", () => {
    expect(
      normalizeUserContextHooks([
        {
          id: "hook-subagent",
          event: "run_started",
          behavior: "subagent",
          waitMode: "unblocking",
          maxTurns: 999,
          title: "Background research",
          content: "先整理背景资料。",
          enabled: true
        }
      ])
    ).toEqual([
      {
        id: "hook-subagent",
        event: "run_started",
        behavior: "subagent",
        waitMode: "unblocking",
        maxTurns: 200,
        title: "Background research",
        content: "先整理背景资料。",
        enabled: true
      }
    ]);
  });

  test("rejects unsupported run_end subagent hooks", () => {
    expect(
      normalizeUserContextHooks([
        {
          id: "hook-invalid",
          event: "run_end",
          behavior: "subagent",
          waitMode: "unblocking",
          title: "Invalid",
          content: "这条不应该保留。",
          enabled: true
        }
      ])
    ).toEqual([]);
  });
});
