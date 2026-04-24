import { describe, expect, test } from "bun:test";

import { buildPromptMessageSections } from "./session-workbench-shared";
import type { RunStreamEvent } from "@ai-app-template/sdk";

const prompt1: Extract<RunStreamEvent, { kind: "prompt" }> = {
  kind: "prompt",
  sessionId: "s1",
  createdAt: "2026-04-24T10:00:00.000Z",
  turnCount: 1,
  system: "sys",
  prefixMessages: [{ role: "user", content: [{ type: "text", text: "u1" }] }],
  messages: [{ role: "assistant", content: [{ type: "text", text: "a1" }] }],
  runtimeContextMessages: [{ role: "user", content: [{ type: "text", text: "ctx1" }] }],
  tools: [],
  toolChoice: null,
  cacheKey: "k1"
};

const prompt2: Extract<RunStreamEvent, { kind: "prompt" }> = {
  ...prompt1,
  createdAt: "2026-04-24T10:01:00.000Z",
  turnCount: 2,
  messages: [{ role: "assistant", content: [{ type: "text", text: "a2" }] }],
  cacheKey: "k2"
};

describe("buildPromptMessageSections", () => {
  test("first turn renders full context", () => {
    const sections = buildPromptMessageSections([prompt1]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.mode).toBe("full");
    expect(sections[0]?.fullText).toContain('"a1"');
  });

  test("second turn renders added and removed lines", () => {
    const sections = buildPromptMessageSections([prompt1, prompt2]);
    expect(sections).toHaveLength(2);
    expect(sections[1]?.mode).toBe("diff");
    expect(sections[1]?.addedText).toContain('+           "text": "a2"');
    expect(sections[1]?.removedText).toContain('-           "text": "a1"');
  });
});
