import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SESSION_MAX_TURNS,
  DEFAULT_SESSION_WORKING_DIRECTORY,
  PERMISSION_TOOL_OPTIONS
} from "@ai-app-template/domain";

import {
  createMemorySettingsRepository,
  createPostgresSettingsRepository
} from "../src/settings-repository.js";

function createFakeSql(responses: unknown[]) {
  const calls: Array<{ values: unknown[] }> = [];
  const sql = ((_: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ values });
    return Promise.resolve(responses.shift());
  }) as unknown as Parameters<typeof createPostgresSettingsRepository>[0];

  return { sql, calls };
}

describe("MemorySettingsRepository", () => {
  test("seeds default settings per user on first read", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.getOrCreate("user-a");

    expect(settings.userId).toBe("user-a");
    expect(settings.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(settings.yoloMode).toBe(false);
    expect(settings.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(settings.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
    expect(settings.toolAskList).toEqual([...PERMISSION_TOOL_OPTIONS]);
  });

  test("updates one user's settings without affecting another user", async () => {
    const repository = createMemorySettingsRepository();

    await repository.update("user-a", {
      workingDirectory: "/tmp/custom-workspace",
      yoloMode: true,
      contextWindow: 123_456,
      maxTurns: 88
    });

    const userA = await repository.getOrCreate("user-a");
    const userB = await repository.getOrCreate("user-b");

    expect(userA.workingDirectory).toBe("/tmp/custom-workspace");
    expect(userA.yoloMode).toBe(true);
    expect(userA.contextWindow).toBe(123_456);
    expect(userA.maxTurns).toBe(88);

    expect(userB.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(userB.yoloMode).toBe(false);
    expect(userB.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(userB.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
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
    const { sql, calls } = createFakeSql([
      [
        {
          user_id: "user-a",
          working_directory: DEFAULT_SESSION_WORKING_DIRECTORY,
          yolo_mode: false,
          context_window: DEFAULT_CONTEXT_WINDOW,
          max_turns: DEFAULT_SESSION_MAX_TURNS,
          shell_allow_patterns: '["ls *"]',
          shell_deny_patterns: "[]",
          tool_allow_list: '["read_file"]',
          tool_ask_list: '["write_file"]',
          tool_deny_list: "[]",
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z"
        }
      ],
      [
        {
          user_id: "user-a",
          working_directory: DEFAULT_SESSION_WORKING_DIRECTORY,
          yolo_mode: true,
          context_window: DEFAULT_CONTEXT_WINDOW,
          max_turns: DEFAULT_SESSION_MAX_TURNS,
          shell_allow_patterns: '["ls *","ls -la *"]',
          shell_deny_patterns: '["rm -rf *"]',
          tool_allow_list: '["read_file","write_file"]',
          tool_ask_list: '["search_text"]',
          tool_deny_list: '["delete_path"]',
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T01:00:00.000Z"
        }
      ]
    ]);

    const repository = createPostgresSettingsRepository(sql);

    const settings = await repository.update("user-a", {
      yoloMode: true,
      shellAllowPatterns: ["ls *", "ls -la *"],
      shellDenyPatterns: ["rm -rf *"],
      toolAllowList: ["read_file", "write_file"],
      toolAskList: ["search_text"],
      toolDenyList: ["delete_path"]
    });

    expect(settings.shellAllowPatterns).toEqual(["ls *", "ls -la *"]);
    expect(settings.shellDenyPatterns).toEqual(["rm -rf *"]);
    expect(settings.toolAllowList).toEqual(["read_file", "write_file"]);
    expect(settings.toolAskList).toEqual(["search_text"]);
    expect(settings.toolDenyList).toEqual(["delete_path"]);
    expect(calls.length).toBe(2);
  });
});
