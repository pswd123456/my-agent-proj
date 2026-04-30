import { describe, expect, test } from "bun:test";
import type {
  RoutineRecord,
  SessionSnapshot,
  SettingsPermissionToolOption
} from "@ai-app-template/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { InspectorProjection } from "./session-message-manager";
import { SessionWorkbenchDrawer } from "./session-workbench-drawer";
import type { SettingsFormState } from "./session-workbench-types";

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

function createSettingsFormState(): SettingsFormState {
  return {
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    thinkingEffort: "medium",
    yoloMode: false,
    contextWindow: "200000",
    maxTurns: "50",
    shellAllowPatterns: "",
    shellDenyPatterns: "",
    toolAllowList: [],
    toolAskList: [],
    toolDenyList: [],
    enabledCapabilityPacks: ["workspace"],
    userContextHooks: [],
    debugConversationView: false,
    userCustomPrompt: ""
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

const permissionTools: SettingsPermissionToolOption[] = [];
const groupedRoutines = new Map<string, RoutineRecord[]>();

describe("session-workbench drawer", () => {
  test("shows clear-history failures in the settings panel", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionWorkbenchDrawer, {
        activeSidebarPanel: "settings",
        currentSession: createSessionSnapshot(),
        loadingSession: false,
        submitting: false,
        resettingRoutines: false,
        settingsMeta: "user cli-user",
        settingsStatusText: "",
        settingsForm: createSettingsFormState(),
        permissionTools,
        loadingSettings: false,
        savingSettings: false,
        clearingSessionHistory: false,
        clearHistoryErrorText:
          "One or more sessions are currently running. Wait for active runs to finish before clearing history.",
        choosingWorkingDirectory: false,
        pendingPermissionToolName: null,
        weekDates: [],
        groupedRoutines,
        inspectorProjection: createInspectorProjection(),
        activeTab: "prompt",
        onResetAllRoutines: () => {},
        onSelectTab: () => {},
        onSettingsFormChange: () => {},
        onSettingsBlur: () => {},
        onChooseWorkingDirectory: () => {},
        onClearSessionHistory: () => {},
        onSettingsYoloModeChange: () => {},
        onSettingsDebugConversationViewChange: () => {},
        onSettingsPermissionToolToggle: () => {},
        onSettingsCapabilityPackToggle: () => {},
        onSettingsShellAllowPatternRemove: () => {},
        onAddUserContextHook: () => {},
        onUserContextHookChange: () => {},
        onUserContextHookBlur: () => {},
        onUserContextHookEnabledChange: () => {},
        onUserContextHookEventChange: () => {},
        onUserContextHookBehaviorChange: () => {},
        onDeleteUserContextHook: () => {},
        onMoveUserContextHook: () => {}
      })
    );

    expect(markup).toContain("清除历史会话");
    expect(markup).toContain(
      "One or more sessions are currently running. Wait for active runs to finish before clearing history."
    );
  });

  test("renders saved shell allow patterns in the settings panel", () => {
    const settingsForm = createSettingsFormState();
    settingsForm.shellAllowPatterns = "git *\nbun test *";

    const markup = renderToStaticMarkup(
      createElement(SessionWorkbenchDrawer, {
        activeSidebarPanel: "settings",
        currentSession: createSessionSnapshot(),
        loadingSession: false,
        submitting: false,
        resettingRoutines: false,
        settingsMeta: "user cli-user",
        settingsStatusText: "",
        settingsForm,
        permissionTools,
        loadingSettings: false,
        savingSettings: false,
        clearingSessionHistory: false,
        clearHistoryErrorText: null,
        choosingWorkingDirectory: false,
        pendingPermissionToolName: null,
        weekDates: [],
        groupedRoutines,
        inspectorProjection: createInspectorProjection(),
        activeTab: "prompt",
        onResetAllRoutines: () => {},
        onSelectTab: () => {},
        onSettingsFormChange: () => {},
        onSettingsBlur: () => {},
        onChooseWorkingDirectory: () => {},
        onClearSessionHistory: () => {},
        onSettingsYoloModeChange: () => {},
        onSettingsDebugConversationViewChange: () => {},
        onSettingsPermissionToolToggle: () => {},
        onSettingsCapabilityPackToggle: () => {},
        onSettingsShellAllowPatternRemove: () => {},
        onAddUserContextHook: () => {},
        onUserContextHookChange: () => {},
        onUserContextHookBlur: () => {},
        onUserContextHookEnabledChange: () => {},
        onUserContextHookEventChange: () => {},
        onUserContextHookBehaviorChange: () => {},
        onDeleteUserContextHook: () => {},
        onMoveUserContextHook: () => {}
      })
    );

    expect(markup).toContain("Allow Patterns");
    expect(markup).toContain("git *");
    expect(markup).toContain("bun test *");
    expect(markup).toContain("移除");
  });

  test("renders the custom prompt field in the settings panel", () => {
    const settingsForm = createSettingsFormState();
    settingsForm.userCustomPrompt = "先确认上下文，再动手。";

    const markup = renderToStaticMarkup(
      createElement(SessionWorkbenchDrawer, {
        activeSidebarPanel: "settings",
        currentSession: createSessionSnapshot(),
        loadingSession: false,
        submitting: false,
        resettingRoutines: false,
        settingsMeta: "user cli-user",
        settingsStatusText: "",
        settingsForm,
        permissionTools,
        loadingSettings: false,
        savingSettings: false,
        clearingSessionHistory: false,
        clearHistoryErrorText: null,
        choosingWorkingDirectory: false,
        pendingPermissionToolName: null,
        weekDates: [],
        groupedRoutines,
        inspectorProjection: createInspectorProjection(),
        activeTab: "prompt",
        onResetAllRoutines: () => {},
        onSelectTab: () => {},
        onSettingsFormChange: () => {},
        onSettingsBlur: () => {},
        onChooseWorkingDirectory: () => {},
        onClearSessionHistory: () => {},
        onSettingsYoloModeChange: () => {},
        onSettingsDebugConversationViewChange: () => {},
        onSettingsPermissionToolToggle: () => {},
        onSettingsCapabilityPackToggle: () => {},
        onSettingsShellAllowPatternRemove: () => {},
        onAddUserContextHook: () => {},
        onUserContextHookChange: () => {},
        onUserContextHookBlur: () => {},
        onUserContextHookEnabledChange: () => {},
        onUserContextHookEventChange: () => {},
        onUserContextHookBehaviorChange: () => {},
        onDeleteUserContextHook: () => {},
        onMoveUserContextHook: () => {}
      })
    );

    expect(markup).toContain("Custom Prompt");
    expect(markup).toContain("先确认上下文，再动手。");
    expect(markup).toContain("适合放长期偏好、回答约束或固定执行提醒");
  });

  test("renders the hooks panel with saved hook items", () => {
    const settingsForm = createSettingsFormState();
    settingsForm.userContextHooks = [
      {
        id: "hook-1",
        event: "run_end",
        title: "Wrap up",
        content: "结束时补一个 next step。",
        enabled: true
      }
    ];

    const markup = renderToStaticMarkup(
      createElement(SessionWorkbenchDrawer, {
        activeSidebarPanel: "hooks",
        currentSession: createSessionSnapshot(),
        loadingSession: false,
        submitting: false,
        resettingRoutines: false,
        settingsMeta: "user cli-user",
        settingsStatusText: "",
        settingsForm,
        permissionTools,
        loadingSettings: false,
        savingSettings: false,
        clearingSessionHistory: false,
        clearHistoryErrorText: null,
        choosingWorkingDirectory: false,
        pendingPermissionToolName: null,
        weekDates: [],
        groupedRoutines,
        inspectorProjection: createInspectorProjection(),
        activeTab: "prompt",
        onResetAllRoutines: () => {},
        onSelectTab: () => {},
        onSettingsFormChange: () => {},
        onSettingsBlur: () => {},
        onChooseWorkingDirectory: () => {},
        onClearSessionHistory: () => {},
        onSettingsYoloModeChange: () => {},
        onSettingsDebugConversationViewChange: () => {},
        onSettingsPermissionToolToggle: () => {},
        onSettingsCapabilityPackToggle: () => {},
        onSettingsShellAllowPatternRemove: () => {},
        onAddUserContextHook: () => {},
        onUserContextHookChange: () => {},
        onUserContextHookBlur: () => {},
        onUserContextHookEnabledChange: () => {},
        onUserContextHookEventChange: () => {},
        onUserContextHookBehaviorChange: () => {},
        onDeleteUserContextHook: () => {},
        onMoveUserContextHook: () => {}
      })
    );

    expect(markup).toContain("配置 context 注入或自动发送消息");
    expect(markup).toContain("Wrap up");
    expect(markup).toContain("结束时补一个 next step。");
    expect(markup).toContain("1/1 enabled");
  });
});
