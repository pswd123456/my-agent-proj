import { describe, expect, test } from "bun:test";
import type { SessionSummary } from "@ai-app-template/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildPromptMessageSections,
  extractDynamicPromptMessages,
  getDisplayStateToneClass,
  getEffectiveTurnInputTokens,
  getPeakTurnContextTokens,
  getSidebarStateBadgeClass,
  formatContextWindowUsage,
  getWorkbenchSwitchState,
  SessionWorkbenchSidebar,
  stringifyPromptDebugValue,
  WorkbenchSwitch
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

describe("session sidebar prompt preview", () => {
  function createSessionSummary(
    firstUserMessage: string | null
  ): SessionSummary {
    return {
      sessionId: "session-1",
      parentSessionId: null,
      updatedAt: "2026-04-28T00:00:00.000Z",
      workingDirectory: "/tmp/workspace",
      yoloMode: false,
      model: "MiniMax-M2.7",
      loopState: "waiting for input",
      turnCount: 1,
      pendingToolCallIds: [],
      interruptRequested: false,
      pendingPermission: false,
      pendingConfirmation: false,
      pendingUserQuestion: false,
      pendingBackgroundNotificationCount: 0,
      activeBackgroundTaskCount: 0,
      status: "waiting_for_user_input",
      firstUserMessage,
      lastUserMessage: firstUserMessage
    };
  }

  test("renders a truncated first user prompt in the sidebar row", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionWorkbenchSidebar, {
        sessions: [createSessionSummary("请帮我检查 runtime 的循环退出条件")],
        selectedSessionId: "session-1",
        activeSidebarPanel: null,
        collapsed: false,
        deletingSessionId: null,
        loading: false,
        creatingSession: false,
        onCreateSession: () => {},
        onSelectSession: () => {},
        onDeleteSession: () => {},
        onToggleSidebarPanel: () => {}
      })
    );

    expect(markup).toContain("请帮我检查 runtim...");
    expect(markup).toContain('title="请帮我检查 runtime 的循环退出条件"');
  });

  test("falls back to a new-session label when no prompt exists yet", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionWorkbenchSidebar, {
        sessions: [createSessionSummary(null)],
        selectedSessionId: "session-1",
        activeSidebarPanel: null,
        collapsed: false,
        deletingSessionId: null,
        loading: false,
        creatingSession: false,
        onCreateSession: () => {},
        onSelectSession: () => {},
        onDeleteSession: () => {},
        onToggleSidebarPanel: () => {}
      })
    );

    expect(markup).toContain("新会话");
  });

  test("shows the persisted model label in the sidebar row", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionWorkbenchSidebar, {
        sessions: [
          {
            ...createSessionSummary("请帮我检查 runtime 的循环退出条件"),
            model: "MiniMax-M2.7"
          }
        ],
        selectedSessionId: "session-1",
        activeSidebarPanel: null,
        collapsed: false,
        deletingSessionId: null,
        loading: false,
        creatingSession: false,
        onCreateSession: () => {},
        onSelectSession: () => {},
        onDeleteSession: () => {},
        onToggleSidebarPanel: () => {}
      })
    );

    expect(markup).toContain("MiniMax-M2.7");
    expect(markup).not.toContain("yolo on");
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

describe("context window formatting", () => {
  test("formats a single-turn input usage ratio", () => {
    expect(formatContextWindowUsage(39_554, 200_000)).toBe(
      "39,554 / ctx 200,000 (19.8%)"
    );
  });

  test("shows an empty single-turn usage when no response has been observed", () => {
    expect(formatContextWindowUsage(null, 200_000)).toBe("-- / ctx 200,000");
  });
});

describe("workbench switch", () => {
  test("maps checked state to data attributes", () => {
    expect(getWorkbenchSwitchState(true)).toBe("true");
    expect(getWorkbenchSwitchState(false)).toBe("false");
  });

  test("renders switch semantics and state markup", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkbenchSwitch, {
        checked: true,
        disabled: true,
        ariaLabel: "切换 plan mode",
        onChange: () => {}
      })
    );

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="切换 plan mode"');
    expect(markup).toContain('data-checked="true"');
    expect(markup).toContain("app-switch-thumb");
    expect(markup).toContain("disabled");
  });
});

describe("turn context tokens", () => {
  test("adds cached tokens into effective turn context", () => {
    expect(
      getEffectiveTurnInputTokens({
        inputTokens: 5_152,
        cacheReadInputTokens: 65_408,
        cacheCreationInputTokens: 0
      })
    ).toBe(70_560);
  });

  test("returns the highest single-turn effective context usage", () => {
    expect(
      getPeakTurnContextTokens(
        new Map([
          [
            1,
            {
              inputTokens: 2_855,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0
            }
          ],
          [
            2,
            {
              inputTokens: 39_554,
              cacheReadInputTokens: 2_613,
              cacheCreationInputTokens: 0
            }
          ],
          [
            3,
            {
              inputTokens: 12_570,
              cacheReadInputTokens: 65_408,
              cacheCreationInputTokens: 0
            }
          ]
        ])
      )
    ).toBe(77_978);
  });

  test("returns null when the session has no turn usage yet", () => {
    expect(getPeakTurnContextTokens(new Map())).toBeNull();
  });
});
