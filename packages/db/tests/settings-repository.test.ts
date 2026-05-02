import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SESSION_MODEL,
  DEFAULT_SESSION_MAX_TURNS,
  DEFAULT_SESSION_WORKING_DIRECTORY,
  SETTINGS_PERMISSION_TOOL_OPTIONS
} from "@ai-app-template/domain";

import {
  createMemorySettingsRepository,
  mapSettingsRow
} from "../src/settings-repository.js";

describe("MemorySettingsRepository", () => {
  test("seeds default settings per user on first read", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.getOrCreate("user-a");

    expect(settings.userId).toBe("user-a");
    expect(settings.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(settings.model).toBe(DEFAULT_SESSION_MODEL);
    expect(settings.yoloMode).toBe(false);
    expect(settings.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(settings.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
    expect(settings.toolAskList).toEqual([...SETTINGS_PERMISSION_TOOL_OPTIONS]);
    expect(settings.enabledCapabilityPacks).toEqual([
      "workspace",
      "schedule",
      "lsp"
    ]);
    expect(settings.workspaceSkillSettings).toEqual([]);
    expect(settings.userContextHooks).toEqual([]);
    expect(settings.debugConversationView).toBe(false);
    expect(settings.userCustomPrompt).toBe("");
  });

  test("uses injected settings permission tools for defaults and normalization", async () => {
    const repository = createMemorySettingsRepository({
      settingsPermissionToolOptions: ["read_file", "new_tool"]
    });

    const seeded = await repository.getOrCreate("user-dynamic");
    expect(seeded.toolAskList).toEqual(["read_file", "new_tool"]);

    const updated = await repository.update("user-dynamic", {
      toolAllowList: ["read_file", "new_tool", "write_file"],
      toolAskList: ["new_tool"],
      toolDenyList: ["write_file"]
    });

    expect(updated.toolAllowList).toEqual(["read_file", "new_tool"]);
    expect(updated.toolAskList).toEqual([]);
    expect(updated.toolDenyList).toEqual([]);
  });

  test("updates one user's settings without affecting another user", async () => {
    const repository = createMemorySettingsRepository();

    await repository.update("user-a", {
      workingDirectory: "/tmp/custom-workspace",
      model: "deepseek-v4-pro",
      yoloMode: true,
      contextWindow: 123_456,
      maxTurns: 88,
      debugConversationView: true,
      workspaceSkillSettings: [
        {
          skillName: "repo_reader",
          enabled: false
        }
      ],
      userCustomPrompt: "先确认上下文，再动手。"
    });

    const userA = await repository.getOrCreate("user-a");
    const userB = await repository.getOrCreate("user-b");

    expect(userA.workingDirectory).toBe("/tmp/custom-workspace");
    expect(userA.model).toBe("deepseek-v4-pro");
    expect(userA.yoloMode).toBe(true);
    expect(userA.contextWindow).toBe(123_456);
    expect(userA.maxTurns).toBe(88);
    expect(userA.workspaceSkillSettings).toEqual([
      {
        skillName: "repo_reader",
        enabled: false
      }
    ]);
    expect(userA.userContextHooks).toEqual([]);
    expect(userA.debugConversationView).toBe(true);
    expect(userA.userCustomPrompt).toBe("先确认上下文，再动手。");

    expect(userB.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(userB.model).toBe(DEFAULT_SESSION_MODEL);
    expect(userB.yoloMode).toBe(false);
    expect(userB.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(userB.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
    expect(userB.workspaceSkillSettings).toEqual([]);
    expect(userB.userContextHooks).toEqual([]);
    expect(userB.debugConversationView).toBe(false);
    expect(userB.userCustomPrompt).toBe("");
  });

  test("normalizes workspace skill settings by unique trimmed skill name", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.update("user-skills", {
      workspaceSkillSettings: [
        {
          skillName: " repo_reader ",
          enabled: false
        },
        {
          skillName: "repo_reader",
          enabled: true
        },
        {
          skillName: "schedule_helper",
          enabled: true
        },
        {
          skillName: "   ",
          enabled: false
        }
      ]
    });

    expect(settings.workspaceSkillSettings).toEqual([
      {
        skillName: "repo_reader",
        enabled: false
      },
      {
        skillName: "schedule_helper",
        enabled: true
      }
    ]);
  });

  test("round-trips normalized user context hooks", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.update("user-hooks", {
      userContextHooks: [
        {
          id: "hook-1",
          event: "run_started",
          title: "Profile",
          content: "先看长期偏好，再决定回答风格。",
          enabled: true
        },
        {
          id: "hook-2",
          event: "run_end",
          title: "Wrap up",
          content: "结尾给一个简短 next step。",
          enabled: false
        },
        {
          id: "hook-2",
          event: "session_started",
          title: "Duplicate id",
          content: "ignored",
          enabled: true
        },
        {
          id: "hook-3",
          event: "run_started",
          title: "Blank",
          content: "   ",
          enabled: true
        },
        {
          id: "hook-4",
          event: "run_started",
          title: "Duplicate type",
          content: "同一类型只能同时启用一条。",
          enabled: true
        }
      ]
    });

    expect(settings.userContextHooks).toEqual([
      {
        id: "hook-1",
        event: "run_started",
        title: "Profile",
        content: "先看长期偏好，再决定回答风格。",
        enabled: true
      },
      {
        id: "hook-2",
        event: "run_end",
        title: "Wrap up",
        content: "结尾给一个简短 next step。",
        enabled: false
      },
      {
        id: "hook-4",
        event: "run_started",
        title: "Duplicate type",
        content: "同一类型只能同时启用一条。",
        enabled: false
      }
    ]);
  });

  test("preserves subagent hook wait mode during settings normalization", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.update("user-subagent-hooks", {
      userContextHooks: [
        {
          id: "hook-subagent",
          event: "session_started",
          behavior: "subagent",
          waitMode: "unblocking",
          maxTurns: 100,
          title: "Background research",
          content: "先整理背景资料。",
          enabled: true
        }
      ]
    });

    expect(settings.userContextHooks).toEqual([
      {
        id: "hook-subagent",
        event: "session_started",
        behavior: "subagent",
        waitMode: "unblocking",
        maxTurns: 100,
        title: "Background research",
        content: "先整理背景资料。",
        enabled: true
      }
    ]);
  });

  test("normalizes conflicting tool permission lists with deny then allow precedence", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.update("user-a", {
      toolAllowList: ["read_file", "write_file", "search_text"],
      toolAskList: ["read_file", "search_text", "delete_path"],
      toolDenyList: ["read_file", "delete_path"]
    });

    expect(settings.toolAllowList).toEqual(["write_file", "search_text"]);
    expect(settings.toolAskList).toEqual([]);
    expect(settings.toolDenyList).toEqual(["read_file", "delete_path"]);
  });

  test("strips shell and network tools from persisted tool permission lists", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.update("user-a", {
      toolAllowList: ["read_file", "run_shell_command", "make_http_request"],
      toolAskList: ["make_http_request", "write_file"],
      toolDenyList: ["run_shell_command", "delete_path"]
    });

    expect(settings.toolAllowList).toEqual(["read_file"]);
    expect(settings.toolAskList).toEqual(["write_file"]);
    expect(settings.toolDenyList).toEqual(["delete_path"]);
  });

  test("parses legacy JSON string columns from postgres rows", async () => {
    const settings = mapSettingsRow({
      userId: "user-a",
      workingDirectory: DEFAULT_SESSION_WORKING_DIRECTORY,
      model: DEFAULT_SESSION_MODEL,
      yoloMode: true,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTurns: DEFAULT_SESSION_MAX_TURNS,
      shellAllowPatterns: '["ls *","ls -la *"]',
      shellDenyPatterns: '["rm -rf *"]',
      toolAllowList: '["read_file","write_file"]',
      toolAskList: '["search_text"]',
      toolDenyList: '["delete_path"]',
      enabledCapabilityPacks: '["workspace","schedule"]',
      workspace_skill_settings: '[{"skillName":"repo_reader","enabled":false}]',
      user_context_hooks:
        '[{"id":"hook-1","event":"run_started","title":"Profile","content":"先看偏好","enabled":true}]',
      debug_conversation_view: true,
      user_custom_prompt: "默认先检查上下文。",
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T01:00:00.000Z"
    } as never);

    expect(settings.shellAllowPatterns).toEqual(["ls *", "ls -la *"]);
    expect(settings.shellDenyPatterns).toEqual(["rm -rf *"]);
    expect(settings.toolAllowList).toEqual(["read_file", "write_file"]);
    expect(settings.toolAskList).toEqual(["search_text"]);
    expect(settings.toolDenyList).toEqual(["delete_path"]);
    expect(settings.model).toBe(DEFAULT_SESSION_MODEL);
    expect(settings.workspaceSkillSettings).toEqual([
      {
        skillName: "repo_reader",
        enabled: false
      }
    ]);
    expect(settings.userContextHooks).toEqual([
      {
        id: "hook-1",
        event: "run_started",
        title: "Profile",
        content: "先看偏好",
        enabled: true
      }
    ]);
    expect(settings.debugConversationView).toBe(true);
    expect(settings.userCustomPrompt).toBe("默认先检查上下文。");
  });
});
