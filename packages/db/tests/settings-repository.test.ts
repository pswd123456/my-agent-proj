import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SESSION_MODEL,
  DEFAULT_SESSION_MAX_TURNS,
  DEFAULT_SESSION_WORKING_DIRECTORY,
  PERMISSION_TOOL_OPTIONS
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
    expect(settings.toolAskList).toEqual([...PERMISSION_TOOL_OPTIONS]);
    expect(settings.debugConversationView).toBe(false);
  });

  test("updates one user's settings without affecting another user", async () => {
    const repository = createMemorySettingsRepository();

    await repository.update("user-a", {
      workingDirectory: "/tmp/custom-workspace",
      model: "deepseek-v4-pro",
      yoloMode: true,
      contextWindow: 123_456,
      maxTurns: 88,
      debugConversationView: true
    });

    const userA = await repository.getOrCreate("user-a");
    const userB = await repository.getOrCreate("user-b");

    expect(userA.workingDirectory).toBe("/tmp/custom-workspace");
    expect(userA.model).toBe("deepseek-v4-pro");
    expect(userA.yoloMode).toBe(true);
    expect(userA.contextWindow).toBe(123_456);
    expect(userA.maxTurns).toBe(88);
    expect(userA.debugConversationView).toBe(true);

    expect(userB.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(userB.model).toBe(DEFAULT_SESSION_MODEL);
    expect(userB.yoloMode).toBe(false);
    expect(userB.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(userB.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
    expect(userB.debugConversationView).toBe(false);
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
      debug_conversation_view: true,
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T01:00:00.000Z"
    } as never);

    expect(settings.shellAllowPatterns).toEqual(["ls *", "ls -la *"]);
    expect(settings.shellDenyPatterns).toEqual(["rm -rf *"]);
    expect(settings.toolAllowList).toEqual(["read_file", "write_file"]);
    expect(settings.toolAskList).toEqual(["search_text"]);
    expect(settings.toolDenyList).toEqual(["delete_path"]);
    expect(settings.model).toBe(DEFAULT_SESSION_MODEL);
    expect(settings.debugConversationView).toBe(true);
  });
});
