import { describe, expect, test } from "bun:test";

import { parseInboxCommand } from "../src/inbox.js";

describe("parseInboxCommand", () => {
  test("parses session commands", () => {
    expect(parseInboxCommand("/new deepseek-v4-pro max")).toEqual({
      kind: "new_session",
      model: "deepseek-v4-pro",
      thinkingEffort: "max"
    });
    expect(parseInboxCommand("/new high")).toEqual({
      kind: "new_session",
      thinkingEffort: "high"
    });
    expect(parseInboxCommand("/switch session-1")).toEqual({
      kind: "switch_session",
      sessionId: "session-1"
    });
    expect(parseInboxCommand("/session")).toEqual({
      kind: "session_status"
    });
  });

  test("parses settings and control commands", () => {
    expect(parseInboxCommand("/model")).toEqual({ kind: "list_models" });
    expect(parseInboxCommand("/model MiniMax-M2.7")).toEqual({
      kind: "set_model",
      model: "MiniMax-M2.7"
    });
    expect(parseInboxCommand("/thinking")).toEqual({
      kind: "list_thinking_efforts"
    });
    expect(parseInboxCommand("/thinking max")).toEqual({
      kind: "set_thinking_effort",
      thinkingEffort: "max"
    });
    expect(parseInboxCommand("/output all")).toEqual({
      kind: "set_output_mode",
      outputMode: "all"
    });
    expect(parseInboxCommand("/settings")).toEqual({
      kind: "settings_status"
    });
    expect(parseInboxCommand("/interrupt")).toEqual({ kind: "interrupt" });
    expect(parseInboxCommand("/approve")).toEqual({
      kind: "approve_permission"
    });
    expect(parseInboxCommand("/deny")).toEqual({ kind: "deny_permission" });
  });

  test("returns regular messages and structured validation errors", () => {
    expect(parseInboxCommand("hello")).toEqual({
      kind: "message",
      text: "hello"
    });
    expect(parseInboxCommand("/wat")).toEqual({
      kind: "invalid",
      message: 'Unknown command "/wat". Send /help for available commands.'
    });
    expect(parseInboxCommand("/switch")).toEqual({
      kind: "invalid",
      message: "Usage: /switch <sessionId>."
    });
    expect(parseInboxCommand("/output noisy")).toEqual({
      kind: "invalid",
      message: "Usage: /output <final | all>."
    });
    expect(parseInboxCommand("/thinking medium")).toEqual({
      kind: "invalid",
      message: 'Unsupported thinking effort "medium". Supported: high | max.'
    });
  });

  test("accepts Telegram bot-name suffixes on slash commands", () => {
    expect(parseInboxCommand("/model@local_agent_bot deepseek-v4-pro")).toEqual(
      {
        kind: "set_model",
        model: "deepseek-v4-pro"
      }
    );
  });
});
