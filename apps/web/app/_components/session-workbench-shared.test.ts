import { describe, expect, test } from "bun:test";

import {
  buildPromptMessageSections,
  extractDynamicPromptMessages,
  getDisplayStateToneClass,
  getSidebarStateBadgeClass,
  stringifyPromptDebugValue
} from "./session-workbench-shared";

describe("sidebar state tone", () => {
  test("distinguishes active and warning treatments", () => {
    const activeText = getDisplayStateToneClass("active");
    const warningText = getDisplayStateToneClass("warning");
    const activeBadge = getSidebarStateBadgeClass("active");
    const warningBadge = getSidebarStateBadgeClass("warning");

    expect(activeText).not.toBe(warningText);
    expect(activeBadge).not.toBe(warningBadge);
    expect(activeBadge).toContain("app-border-accent");
    expect(warningBadge).toContain("app-status-warning");
    expect(activeBadge).not.toContain("border-[");
    expect(activeBadge).not.toContain("bg-[");
  });
});

describe("prompt debug formatting", () => {
  test("renders escaped newlines as display line breaks", () => {
    expect(
      stringifyPromptDebugValue({
        content: "第一行\n第二行"
      })
    ).toContain("第一行\n第二行");
  });

  test("uses display line breaks when building prompt message sections", () => {
    const [section] = buildPromptMessageSections([
      {
        kind: "prompt",
        sessionId: "session-1",
        createdAt: "2026-04-25T00:00:00.000Z",
        turnCount: 1,
        system: "system",
        prefixMessages: [{ role: "system", content: "A\nB" }],
        runtimeContextMessages: [],
        messages: [],
        tools: [],
        cacheKey: "cache-key",
        toolChoice: null
      }
    ]);

    expect(section?.fullText).toContain("A\nB");
  });

  test("extracts dynamic prompt messages for inspector debug cards", () => {
    expect(
      extractDynamicPromptMessages({
        kind: "prompt",
        sessionId: "session-1",
        createdAt: "2026-04-26T00:00:00.000Z",
        turnCount: 9,
        system: "system",
        prefixMessages: [],
        runtimeContextMessages: [],
        dynamicPromptMessages: ["Turn budget is nearly exhausted."],
        messages: [],
        tools: [],
        cacheKey: "cache-key",
        toolChoice: null
      })
    ).toEqual(["Turn budget is nearly exhausted."]);
  });

  test("keeps only the latest prompt snapshot per turn", () => {
    const sections = buildPromptMessageSections([
      {
        kind: "prompt",
        sessionId: "session-1",
        createdAt: "2026-04-25T00:00:00.000Z",
        turnCount: 1,
        system: "system",
        prefixMessages: [{ role: "system", content: "A" }],
        runtimeContextMessages: [],
        messages: [],
        tools: [],
        cacheKey: "cache-key-1",
        toolChoice: null
      },
      {
        kind: "prompt",
        sessionId: "session-1",
        createdAt: "2026-04-25T00:00:01.000Z",
        turnCount: 1,
        system: "system",
        prefixMessages: [{ role: "system", content: "B" }],
        runtimeContextMessages: [],
        messages: [],
        tools: [],
        cacheKey: "cache-key-2",
        toolChoice: null
      }
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.fullText).toContain("B");
  });
});
