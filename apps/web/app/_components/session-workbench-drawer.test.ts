import { describe, expect, test } from "bun:test";
import type { RoutineRecord, SessionSnapshot } from "@ai-app-template/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { InspectorProjection } from "./session-message-manager";
import { SessionWorkbenchDrawer } from "./session-workbench-drawer";

function createSessionSnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "user-1",
      status: "waiting_for_user_input",
      currentDateContext: "2026-04-30",
      yoloMode: false,
      planModeEnabled: false,
      thinkingEffort: "medium",
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: ["workspace"],
      activeBackgroundTaskCount: 0,
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingBackgroundNotifications: [],
      todoState: null,
      fullCompactionState: null,
      pendingConflictSummary: null,
      firstUserMessage: null,
      lastUserMessage: null
    },
    messages: [],
    sessionState: {
      loopState: "waiting for input",
      turnCount: 0,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false,
      historyCompactionsSinceFullCompaction: 0
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: "2026-04-30T00:00:00.000Z"
  };
}

function createInspectorProjection(): InspectorProjection {
  return {
    inspectorEvents: [],
    promptEvents: [],
    latestPromptEvent: undefined,
    thinkingEvents: [],
    toolRows: [],
    turnUsageByTurnCount: new Map()
  };
}

function renderDrawer(
  props: Partial<Parameters<typeof SessionWorkbenchDrawer>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(SessionWorkbenchDrawer, {
      activeSidebarPanel: "calendar",
      currentSession: createSessionSnapshot(),
      submitting: false,
      resettingRoutines: false,
      weekDates: [],
      groupedRoutines: new Map(),
      inspectorProjection: createInspectorProjection(),
      activeTab: "prompt",
      onResetAllRoutines: () => {},
      onSelectTab: () => {},
      ...props
    })
  );
}

describe("session-workbench drawer", () => {
  test("does not render the settings panel in the drawer", () => {
    const markup = renderDrawer({
      activeSidebarPanel: "settings"
    });

    expect(markup).toBe("");
  });

  test("renders calendar routines", () => {
    const routine: RoutineRecord = {
      id: "routine-1",
      userId: "user-1",
      name: "Deep work",
      description: null,
      date: "2026-04-30",
      startTime: "09:00",
      endTime: "10:00",
      durationMinutes: 60,
      startAt: "2026-04-30T09:00:00.000Z",
      endAt: "2026-04-30T10:00:00.000Z",
      status: "active",
      source: "user_confirmed",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z"
    };

    const markup = renderDrawer({
      weekDates: ["2026-04-30"],
      groupedRoutines: new Map([["2026-04-30", [routine]]])
    });

    expect(markup).toContain("日程视图");
    expect(markup).toContain("Deep work");
    expect(markup).toContain("09:00 - 10:00");
  });

  test("renders inspector details", () => {
    const markup = renderDrawer({
      activeSidebarPanel: "inspector",
      inspectorProjection: {
        ...createInspectorProjection(),
        inspectorEvents: [
          {
            kind: "run_complete",
            createdAt: "2026-04-30T00:00:00.000Z",
            sessionId: "session-1",
            finalAnswer: null,
            status: "waiting for input",
            stopReason: null,
            toolCallCount: 0,
            toolResultCount: 0,
            toolOutputs: [],
            session: createSessionSnapshot()
          }
        ]
      }
    });

    expect(markup).toContain("调试详情");
    expect(markup).toContain("1 events");
  });
});
