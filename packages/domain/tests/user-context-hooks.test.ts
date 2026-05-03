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

  test("normalizes run_end subagent hooks to unblocking mode", () => {
    expect(
      normalizeUserContextHooks([
        {
          id: "hook-run-end",
          event: "run_end",
          behavior: "subagent",
          waitMode: "blocking",
          title: "Wrap up research",
          content: "在当前 run 结束后继续整理收尾信息。",
          enabled: true
        }
      ])
    ).toEqual([
      {
        id: "hook-run-end",
        event: "run_end",
        behavior: "subagent",
        waitMode: "unblocking",
        maxTurns: 100,
        title: "Wrap up research",
        content: "在当前 run 结束后继续整理收尾信息。",
        enabled: true
      }
    ]);
  });
});
