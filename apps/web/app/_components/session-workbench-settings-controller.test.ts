import { describe, expect, mock, test } from "bun:test";

import type {
  SessionSettingsRecord,
  SessionSnapshot,
  SettingsPermissionToolOption,
  UserSettingsChannelsPayload,
  UserSettingsMcpPayload,
  UserSettingsPayload,
  UserSettingsSkillsPayload
} from "@ai-app-template/sdk";

import { saveUserSettingsWithRefresh } from "./session-workbench-settings-controller";
import type {
  SettingsChannelsState,
  SettingsFormState,
  SettingsMcpFormState,
  SettingsSkillsState
} from "./session-workbench-types";

function createSessionSettingsRecord(): SessionSettingsRecord {
  return {
    userId: "user-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    thinkingEffort: "high",
    yoloMode: false,
    contextWindow: 200_000,
    maxTurns: 50,
    shellAllowPatterns: [],
    shellDenyPatterns: [],
    toolAllowList: [],
    toolAskList: [],
    toolDenyList: [],
    enabledCapabilityPacks: ["workspace"],
    workspaceSkillSettings: [],
    userContextHooks: [],
    debugConversationView: false,
    userCustomPrompt: "",
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z"
  };
}

function createSettingsFormState(): SettingsFormState {
  return {
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    thinkingEffort: "high",
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
      currentDateContext: "2026-05-05",
      yoloMode: false,
      planModeEnabled: false,
      thinkingEffort: "high",
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
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
    updatedAt: "2026-05-05T00:00:00.000Z"
  };
}

function createUserSettingsPayload(): UserSettingsPayload {
  return {
    settings: createSessionSettingsRecord(),
    permissionTools: [
      {
        name: "run_shell_command",
        label: "Run Shell Command",
        description: "Run shell commands."
      } satisfies SettingsPermissionToolOption
    ]
  };
}

function createChannelsPayload(): UserSettingsChannelsPayload {
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
      webhookUrl: "https://example.com/webhook"
    },
    telegramBindings: [],
    diagnostics: []
  };
}

function createMcpPayload(): UserSettingsMcpPayload {
  return {
    workingDirectory: "/tmp/workspace",
    configPath: "/tmp/workspace/.agents/.config.toml",
    foundConfig: true,
    diagnostics: [],
    servers: [],
    serverStatuses: []
  };
}

function createSkillsPayload(): UserSettingsSkillsPayload {
  return {
    workingDirectory: "/tmp/workspace",
    skills: [],
    diagnostics: []
  };
}

function createStateRecorder() {
  const calls: string[] = [];
  const recorder = {
    calls,
    userSettings: null as SessionSettingsRecord | null,
    permissionTools: null as SettingsPermissionToolOption[] | null,
    settingsForm: null as SettingsFormState | null,
    channelsState: null as SettingsChannelsState | null,
    mcpForm: null as SettingsMcpFormState | null,
    skillsState: null as SettingsSkillsState | null,
    mcpErrorText: "unchanged" as string | null,
    channelsErrorText: "unchanged" as string | null
  };

  return {
    recorder,
    sync: {
      setUserSettings: (settings: SessionSettingsRecord) => {
        calls.push("setUserSettings");
        recorder.userSettings = settings;
      },
      setPermissionTools: (tools: SettingsPermissionToolOption[]) => {
        calls.push("setPermissionTools");
        recorder.permissionTools = tools;
      },
      setSettingsForm: (form: SettingsFormState) => {
        calls.push("setSettingsForm");
        recorder.settingsForm = form;
      },
      setSettingsChannelsState: (state: SettingsChannelsState) => {
        calls.push("setSettingsChannelsState");
        recorder.channelsState = state;
      },
      setSettingsMcpForm: (form: SettingsMcpFormState) => {
        calls.push("setSettingsMcpForm");
        recorder.mcpForm = form;
      },
      setSettingsSkillsState: (state: SettingsSkillsState) => {
        calls.push("setSettingsSkillsState");
        recorder.skillsState = state;
      },
      setMcpSettingsErrorText: (message: string | null) => {
        calls.push(`setMcpSettingsErrorText:${message ?? "null"}`);
        recorder.mcpErrorText = message;
      },
      setChannelsSettingsErrorText: (message: string | null) => {
        calls.push(`setChannelsSettingsErrorText:${message ?? "null"}`);
        recorder.channelsErrorText = message;
      }
    }
  };
}

describe("session workbench settings controller", () => {
  test("saves user settings, refreshes extended settings, and syncs the current session", async () => {
    const settingsPayload = createUserSettingsPayload();
    settingsPayload.settings.workingDirectory = "/tmp/updated-workspace";
    const channelsPayload = createChannelsPayload();
    const mcpPayload = createMcpPayload();
    const skillsPayload = createSkillsPayload();
    const { recorder, sync } = createStateRecorder();
    const hydrateCurrentSession = mock(() => {});
    const updatedSession = createSessionSnapshot();

    const apiClient = {
      updateUserSettingsPayload: mock(async () => settingsPayload),
      getUserSettingsChannels: mock(async () => channelsPayload),
      getUserSettingsMcp: mock(async () => mcpPayload),
      getUserSettingsSkills: mock(async () => skillsPayload),
      updateSessionSettings: mock(async () => updatedSession)
    } as const;

    const result = await saveUserSettingsWithRefresh({
      apiClient: apiClient as never,
      form: createSettingsFormState(),
      currentSession: createSessionSnapshot(),
      sync,
      hydrateCurrentSession
    });

    expect(result.settingsPayload).toEqual(settingsPayload);
    expect(result.normalizedForm.workingDirectory).toBe("/tmp/workspace");
    expect(apiClient.updateUserSettingsPayload).toHaveBeenCalledTimes(1);
    expect(apiClient.getUserSettingsChannels).toHaveBeenCalledTimes(1);
    expect(apiClient.getUserSettingsMcp).toHaveBeenCalledTimes(1);
    expect(apiClient.getUserSettingsSkills).toHaveBeenCalledTimes(1);
    expect(apiClient.updateSessionSettings).toHaveBeenCalledTimes(1);
    expect(apiClient.updateSessionSettings).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        workingDirectory: "/tmp/updated-workspace"
      })
    );
    expect(hydrateCurrentSession).toHaveBeenCalledWith(updatedSession);
    expect(recorder.userSettings).toEqual(settingsPayload.settings);
    expect(recorder.permissionTools).toEqual(settingsPayload.permissionTools);
    expect(recorder.channelsState?.telegram.enabled).toBe(true);
    expect(recorder.mcpForm?.workingDirectory).toBe("/tmp/workspace");
    expect(recorder.skillsState?.workingDirectory).toBe("/tmp/workspace");
    expect(recorder.mcpErrorText).toBeNull();
    expect(recorder.channelsErrorText).toBeNull();
    expect(recorder.calls).toEqual([
      "setUserSettings",
      "setPermissionTools",
      "setSettingsForm",
      "setSettingsChannelsState",
      "setSettingsMcpForm",
      "setSettingsSkillsState",
      "setMcpSettingsErrorText:null",
      "setChannelsSettingsErrorText:null"
    ]);
  });
});
