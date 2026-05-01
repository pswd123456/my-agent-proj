import { describe, expect, test } from "bun:test";
import type {
  SessionSnapshot,
  SettingsPermissionToolOption
} from "@ai-app-template/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SessionWorkbenchSettings } from "./session-workbench-settings";
import type {
  SettingsFormState,
  SettingsMcpFormState
} from "./session-workbench-types";

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

function createSettingsMcpFormState(): SettingsMcpFormState {
  return {
    workingDirectory: "/tmp/workspace",
    configPath: "/tmp/workspace/.agent/.config.toml",
    foundConfig: true,
    diagnostics: [],
    servers: []
  };
}

function renderSettings(
  props: Partial<Parameters<typeof SessionWorkbenchSettings>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(SessionWorkbenchSettings, {
      activeSettingsPage: "general",
      currentSession: createSessionSnapshot(),
      settingsMeta: "user cli-user",
      settingsStatusText: "",
      settingsForm: createSettingsFormState(),
      settingsMcpForm: createSettingsMcpFormState(),
      permissionTools: [] satisfies SettingsPermissionToolOption[],
      loadingSettings: false,
      savingSettings: false,
      loadingMcpSettings: false,
      savingMcpSettings: false,
      mcpSettingsErrorText: null,
      clearingSessionHistory: false,
      clearHistoryErrorText: null,
      choosingWorkingDirectory: false,
      pendingPermissionToolName: null,
      onReturnToApp: () => {},
      onSelectSettingsPage: () => {},
      onSettingsFormChange: () => {},
      onSettingsBlur: () => {},
      onChooseWorkingDirectory: () => {},
      onClearSessionHistory: () => {},
      onSettingsYoloModeChange: () => {},
      onSettingsDebugConversationViewChange: () => {},
      onSettingsPermissionToolToggle: () => {},
      onSettingsCapabilityPackToggle: () => {},
      onSettingsShellAllowPatternRemove: () => {},
      onAddMcpServer: () => {},
      onMcpServerChange: () => {},
      onMcpServerTransportChange: () => {},
      onMcpServerEnabledChange: () => {},
      onMcpToolEnabledChange: () => {},
      onDeleteMcpServer: () => {},
      onMcpSettingsBlur: () => {},
      onAddUserContextHook: () => {},
      onUserContextHookChange: () => {},
      onUserContextHookBlur: () => {},
      onUserContextHookEnabledChange: () => {},
      onUserContextHookEventChange: () => {},
      onUserContextHookBehaviorChange: () => {},
      onDeleteUserContextHook: () => {},
      onMoveUserContextHook: () => {},
      ...props
    })
  );
}

describe("session-workbench settings mode", () => {
  test("renders settings child navigation with return action", () => {
    const markup = renderSettings();

    expect(markup).toContain("返回应用");
    expect(markup).toContain("常规");
    expect(markup).toContain("权限");
    expect(markup).toContain("MCP");
    expect(markup).toContain("个性化");
  });

  test("renders saved shell allow patterns on the permissions page", () => {
    const settingsForm = createSettingsFormState();
    settingsForm.shellAllowPatterns = "git *\nbun test *";

    const markup = renderSettings({
      activeSettingsPage: "permissions",
      settingsForm
    });

    expect(markup).toContain("Allow Patterns");
    expect(markup).toContain("git *");
    expect(markup).toContain("bun test *");
    expect(markup).toContain("移除");
  });

  test("renders the custom prompt field on the personalization page", () => {
    const settingsForm = createSettingsFormState();
    settingsForm.userCustomPrompt = "先确认上下文，再动手。";

    const markup = renderSettings({
      activeSettingsPage: "personalization",
      settingsForm
    });

    expect(markup).toContain("长期提示");
    expect(markup).toContain("先确认上下文，再动手。");
    expect(markup).toContain("适合放长期偏好、回答约束或固定执行提醒");
  });

  test("renders saved hook items on the hooks page", () => {
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

    const markup = renderSettings({
      activeSettingsPage: "hooks",
      settingsForm
    });

    expect(markup).toContain("Hook 列表");
    expect(markup).toContain("Wrap up");
    expect(markup).toContain("结束时补一个 next step。");
    expect(markup).toContain("1/1 enabled");
  });
});
