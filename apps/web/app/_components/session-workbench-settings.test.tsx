import { describe, expect, test } from "bun:test";
import type {
  SessionSnapshot,
  SettingsPermissionToolOption
} from "@ai-app-template/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SessionWorkbenchSettings } from "./session-workbench-settings";
import type {
  SettingsChannelsState,
  SettingsFormState,
  SettingsMcpFormState,
  SettingsSkillsState
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
      hookContextEntries: [],
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
    workspaceSkillSettings: [],
    userContextHooks: [],
    debugConversationView: false,
    userCustomPrompt: ""
  };
}

function createSettingsSkillsState(): SettingsSkillsState {
  return {
    workingDirectory: "/tmp/workspace",
    skills: [],
    diagnostics: []
  };
}

function createSettingsMcpFormState(): SettingsMcpFormState {
  return {
    workingDirectory: "/tmp/workspace",
    configPath: "/tmp/workspace/.agents/.config.toml",
    foundConfig: true,
    diagnostics: [],
    servers: []
  };
}

function createSettingsChannelsState(): SettingsChannelsState {
  return {
    workingDirectory: "/tmp/workspace",
    configPath: "/tmp/workspace/.agents/.config.toml",
    foundConfig: true,
    telegram: {
      channel: "telegram",
      configuredInFile: true,
      enabled: true,
      mode: "polling",
      botToken: "$TELEGRAM_BOT_TOKEN",
      webhookSecret: "$TELEGRAM_WEBHOOK_SECRET",
      webhookUrl: "https://example.com/api/inbox/telegram/webhook"
    },
    diagnostics: []
  };
}

function renderSettings(
  props: Partial<Parameters<typeof SessionWorkbenchSettings>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(SessionWorkbenchSettings, {
      activeSettingsPage: "general",
      currentSession: createSessionSnapshot(),
      submitting: false,
      resettingRoutines: false,
      weekDates: [],
      groupedRoutines: new Map(),
      settingsMeta: "user cli-user",
      settingsStatusText: "",
      settingsForm: createSettingsFormState(),
      settingsChannelsState: createSettingsChannelsState(),
      settingsMcpForm: createSettingsMcpFormState(),
      settingsSkillsState: createSettingsSkillsState(),
      permissionTools: [] satisfies SettingsPermissionToolOption[],
      loadingSettings: false,
      savingSettings: false,
      loadingChannelsSettings: false,
      loadingMcpSettings: false,
      loadingSkillsSettings: false,
      savingChannelsSettings: false,
      savingMcpSettings: false,
      mcpSettingsErrorText: null,
      channelsSettingsErrorText: null,
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
      onResetAllRoutines: () => {},
      onSettingsYoloModeChange: () => {},
      onSettingsDebugConversationViewChange: () => {},
      onSettingsPermissionToolToggle: () => {},
      onSettingsCapabilityPackToggle: () => {},
      onSettingsShellAllowPatternRemove: () => {},
      onSettingsSkillEnabledChange: () => {},
      onTelegramChannelChange: () => {},
      onTelegramChannelEnabledChange: () => {},
      onChannelSettingsBlur: () => {},
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
      onUserContextHookWaitModeChange: () => {},
      onDeleteUserContextHook: () => {},
      onMoveUserContextHook: () => {},
      ...props
    })
  );
}

describe("session-workbench settings mode", () => {
  test("does not render page-level intro blocks on settings child pages", () => {
    expect(renderSettings({ activeSettingsPage: "general" })).not.toContain(
      "这里配置默认值。修改后会自动保存"
    );
    expect(
      renderSettings({
        activeSettingsPage: "permissions"
      })
    ).not.toContain(
      "先决定默认启用哪些能力，再保存常见的 shell 规则和工具询问策略。"
    );
    expect(renderSettings({ activeSettingsPage: "mcp" })).not.toContain(
      "管理当前工作目录下的 MCP server。"
    );
    expect(renderSettings({ activeSettingsPage: "skills" })).not.toContain(
      "控制当前工作目录下哪些 skills 会进入 runtime context，也会影响search_skill / load_skill 的可见范围。修改后下一次 run 生效。"
    );
    expect(renderSettings({ activeSettingsPage: "channels" })).not.toContain(
      "管理外部消息通道"
    );
    expect(renderSettings({ activeSettingsPage: "hooks" })).not.toContain(
      "为不同 runtime 时机配置 context注入或自动发送消息。修改后会自动保存，并在下一次 run 生效。"
    );
    expect(
      renderSettings({
        activeSettingsPage: "personalization"
      })
    ).not.toContain("这里保留长期有效的偏好");
    expect(renderSettings({ activeSettingsPage: "calendar" })).not.toContain(
      "在默认设置里直接查看当前工作周的日程"
    );
  });

  test("renders settings child navigation with return action", () => {
    const markup = renderSettings();

    expect(markup).toContain("返回应用");
    expect(markup).toContain("常规");
    expect(markup).toContain("权限");
    expect(markup).toContain("MCP");
    expect(markup).toContain("Skills");
    expect(markup).toContain("Channels");
    expect(markup).toContain("个性化");
  });

  test("renders telegram channel settings from config", () => {
    const markup = renderSettings({
      activeSettingsPage: "channels"
    });

    expect(markup).toContain("Telegram");
    expect(markup).toContain("Bot Token");
    expect(markup).toContain("$TELEGRAM_BOT_TOKEN");
    expect(markup).toContain("Webhook URL");
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

  test("renders calendar as a settings child page", () => {
    const markup = renderSettings({
      activeSettingsPage: "calendar",
      weekDates: ["2026-04-30"],
      groupedRoutines: new Map([
        [
          "2026-04-30",
          [
            {
              id: "routine-1",
              userId: "user-1",
              name: "写周报",
              description: null,
              date: "2026-04-30",
              startTime: "10:00",
              endTime: "11:00",
              durationMinutes: 60,
              startAt: "2026-04-30T10:00:00.000Z",
              endAt: "2026-04-30T11:00:00.000Z",
              status: "confirmed",
              source: "manual",
              createdAt: "2026-04-30T09:00:00.000Z",
              updatedAt: "2026-04-30T09:00:00.000Z"
            }
          ]
        ]
      ])
    });

    expect(markup).toContain("日历");
    expect(markup).toContain("重置所有日程");
    expect(markup).toContain("写周报");
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

  test("renders the wait mode controls for subagent hooks", () => {
    const settingsForm = createSettingsFormState();
    settingsForm.userContextHooks = [
      {
        id: "hook-subagent",
        event: "run_started",
        behavior: "subagent",
        waitMode: "unblocking",
        title: "Background research",
        content: "先整理背景资料。",
        enabled: true
      }
    ];

    const markup = renderSettings({
      activeSettingsPage: "hooks",
      settingsForm
    });

    expect(markup).toContain("Subagent");
    expect(markup).toContain("Wait Mode");
    expect(markup).toContain("Unblocking");
  });

  test("renders run_end subagent hooks as unblocking follow-up work", () => {
    const settingsForm = createSettingsFormState();
    settingsForm.userContextHooks = [
      {
        id: "hook-subagent-run-end",
        event: "run_end",
        behavior: "subagent",
        waitMode: "blocking",
        title: "Wrap up research",
        content: "收尾后再整理背景资料。",
        enabled: true
      }
    ];

    const markup = renderSettings({
      activeSettingsPage: "hooks",
      settingsForm
    });

    expect(markup).toContain("Subagent");
    expect(markup).toContain("Run End");
    expect(markup).toContain("Unblocking");
    expect(markup).toContain("后续 run 自动注入");
  });

  test("renders discovered skills on the skills page", () => {
    const markup = renderSettings({
      activeSettingsPage: "skills",
      settingsSkillsState: {
        workingDirectory: "/tmp/workspace",
        skills: [
          {
            name: "repo_reader",
            description: "Read repository structure before implementation.",
            relativePath: ".agents/skills/repo-reader/SKILL.md",
            enabled: false
          }
        ],
        diagnostics: []
      },
      settingsForm: {
        ...createSettingsFormState(),
        workspaceSkillSettings: [
          {
            skillName: "repo_reader",
            enabled: false
          }
        ]
      }
    });

    expect(markup).toContain("Skill 列表");
    expect(markup).toContain("repo_reader");
    expect(markup).toContain(".agents/skills/repo-reader/SKILL.md");
    expect(markup).toContain("0/1 enabled");
  });
});
