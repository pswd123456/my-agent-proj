import { describe, expect, test } from "bun:test";
import type {
  CronJobRecord,
  RoutineRecord,
  SessionSnapshot
} from "@ai-app-template/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { InspectorProjection } from "./session-message-manager";
import { SessionWorkbenchDrawer } from "./session-workbench-drawer";
import { createDefaultCronJobFormState } from "./session-workbench-types";

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
      cronJobs: [],
      currentCronJob: null,
      cronFormState: createDefaultCronJobFormState({
        workingDirectory: "/tmp/workspace"
      }),
      cronLoading: false,
      cronSaving: false,
      cronDeletingJobId: null,
      cronStatusText: null,
      cronErrorText: null,
      choosingWorkingDirectory: false,
      modelCatalog: [],
      defaultModelId: "MiniMax-M2.7",
      submitting: false,
      resettingRoutines: false,
      weekDates: [],
      groupedRoutines: new Map(),
      inspectorProjection: createInspectorProjection(),
      activeTab: "prompt",
      onCreateCronJob: () => {},
      onSelectCronJob: () => {},
      onCronFormChange: () => {},
      onSaveCronJob: () => {},
      onToggleCronJobStatus: () => {},
      onDeleteCronJob: () => {},
      onJumpToCronRun: () => {},
      onChooseWorkingDirectory: () => {},
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

  test("renders cron jobs in the drawer", () => {
    const cronJob: CronJobRecord = {
      id: "cron-1",
      userId: "user-1",
      name: "夜间回顾",
      prompt: "回顾今日进展",
      workingDirectory: "/tmp/workspace",
      scheduleMode: "weekly",
      intervalUnit: null,
      intervalValue: null,
      weekday: "friday",
      timeOfDay: "22:15",
      startsAt: "2026-05-01T14:15:00.000Z",
      nextRunAt: "2026-05-08T14:15:00.000Z",
      maxRuns: null,
      runCount: 2,
      remainingRuns: null,
      status: "active",
      modelOverride: null,
      thinkingEffortOverride: null,
      lastRunAt: "2026-05-02T14:15:00.000Z",
      latestRunSessionId: "session-99",
      latestRunStatus: "completed",
      lastError: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    };

    const markup = renderDrawer({
      activeSidebarPanel: "cron",
      cronJobs: [cronJob]
    });

    expect(markup).toContain("定时任务");
    expect(markup).toContain("夜间回顾");
    expect(markup).toContain("最近一次运行");
    expect(markup).toContain("新建任务");
  });

  test("renders cron job cards without nested button markup", () => {
    const cronJob: CronJobRecord = {
      id: "cron-1",
      userId: "user-1",
      name: "夜间回顾",
      prompt: "回顾今日进展",
      workingDirectory: "/tmp/workspace",
      scheduleMode: "weekly",
      intervalUnit: null,
      intervalValue: null,
      weekday: "friday",
      timeOfDay: "22:15",
      startsAt: "2026-05-01T14:15:00.000Z",
      nextRunAt: "2026-05-08T14:15:00.000Z",
      maxRuns: null,
      runCount: 2,
      remainingRuns: null,
      status: "active",
      modelOverride: null,
      thinkingEffortOverride: null,
      lastRunAt: "2026-05-02T14:15:00.000Z",
      latestRunSessionId: "session-99",
      latestRunStatus: "completed",
      lastError: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    };

    const markup = renderDrawer({
      activeSidebarPanel: "cron",
      cronJobs: [cronJob]
    });

    expect(markup).toContain('role="button"');
    expect(markup).not.toContain("<button><button");
  });

  test("renders the standalone cron-create page", () => {
    const markup = renderDrawer({
      activeSidebarPanel: "cron-create"
    });

    expect(markup).toContain("新建定时任务");
    expect(markup).toContain("保存后会按计划自动创建新会话");
    expect(markup).toContain("创建任务");
  });
});
