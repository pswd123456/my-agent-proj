import { describe, expect, test } from "bun:test";

import {
  buildPromptMessageSections,
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
});
