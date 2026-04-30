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
});
