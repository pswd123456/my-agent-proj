import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SESSION_MAX_TURNS,
  DEFAULT_SESSION_MODEL,
  DEFAULT_SESSION_WORKING_DIRECTORY
} from "@ai-app-template/domain";

import { createSettingsConfigStore } from "../src/settings-config/store.js";

async function createHomeDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "settings-config-home-"));
}

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "settings-config-workspace-"));
}

async function writeWorkspaceConfig(
  workspaceRoot: string,
  content: string
): Promise<void> {
  const agentDirectory = path.join(workspaceRoot, ".agents");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(path.join(agentDirectory, "config.toml"), content, "utf8");
}

describe("settings config store", () => {
  test("seeds default global config when no file exists", async () => {
    const homeDir = await createHomeDir();
    const store = createSettingsConfigStore({ homeDir });

    const settings = await store.getGlobalSettings();

    expect(settings.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(settings.model).toBe(DEFAULT_SESSION_MODEL);
    expect(settings.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(settings.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
    expect(settings.userContextHooks).toEqual([]);
    expect(settings.workspaceSkillSettings).toEqual([]);

    const rawConfig = await readFile(store.getGlobalPath(), "utf8");
    expect(rawConfig).toContain(
      `working_directory = "${DEFAULT_SESSION_WORKING_DIRECTORY}"`
    );
    expect(rawConfig).toContain("workspace_skill_settings = []");
  });

  test("applies field-level workspace overrides on top of global config", async () => {
    const homeDir = await createHomeDir();
    const workspaceRoot = await createWorkspace();
    const store = createSettingsConfigStore({ homeDir });

    await store.updateGlobalSettings({
      workingDirectory: "/tmp/global-workspace",
      model: "deepseek-v4-pro",
      thinkingEffort: "max",
      yoloMode: true,
      contextWindow: 123_456,
      maxTurns: 44,
      workspaceSkillSettings: [{ skillName: "planner", enabled: true }],
      userContextHooks: [
        {
          id: "global-hook",
          event: "run_started",
          title: "Global",
          content: "先看全局上下文。",
          enabled: true
        }
      ]
    });

    await writeWorkspaceConfig(
      workspaceRoot,
      [
        'working_directory = "/tmp/workspace-override"',
        'context_window = 222222',
        "",
        "workspace_skill_settings = [{ skillName = \"repo_reader\", enabled = false }]",
        "",
        "[channels.telegram]",
        "enabled = true",
        'mode = "polling"',
        'bot_token = "$TELEGRAM_BOT_TOKEN"'
      ].join("\n")
    );

    const effective = await store.getEffectiveSettings(workspaceRoot);

    expect(effective.workingDirectory).toBe("/tmp/workspace-override");
    expect(effective.contextWindow).toBe(222_222);
    expect(effective.model).toBe("deepseek-v4-pro");
    expect(effective.thinkingEffort).toBe("max");
    expect(effective.yoloMode).toBe(true);
    expect(effective.maxTurns).toBe(44);
    expect(effective.workspaceSkillSettings).toEqual([
      { skillName: "repo_reader", enabled: false }
    ]);
    expect(effective.userContextHooks).toEqual([
      {
        id: "global-hook",
        event: "run_started",
        title: "Global",
        content: "先看全局上下文。",
        enabled: true
      }
    ]);
    expect(effective.channels.telegram).toMatchObject({
      enabled: true,
      mode: "polling",
      botToken: "$TELEGRAM_BOT_TOKEN"
    });
  });

  test("treats workspace arrays and hooks as declared-field replacement", async () => {
    const homeDir = await createHomeDir();
    const workspaceRoot = await createWorkspace();
    const store = createSettingsConfigStore({ homeDir });

    await store.updateGlobalSettings({
      workspaceSkillSettings: [
        { skillName: "planner", enabled: true },
        { skillName: "repo_reader", enabled: false }
      ],
      userContextHooks: [
        {
          id: "global-hook",
          event: "run_started",
          title: "Global",
          content: "global",
          enabled: true
        }
      ]
    });

    await writeWorkspaceConfig(
      workspaceRoot,
      [
        "workspace_skill_settings = [{ skillName = \"workspace_only\", enabled = true }]",
        "",
        "user_context_hooks = [",
        "  { id = \"workspace-hook\", event = \"run_end\", title = \"Workspace\", content = \"workspace\", enabled = true }",
        "]"
      ].join("\n")
    );

    const effective = await store.getEffectiveSettings(workspaceRoot);

    expect(effective.workspaceSkillSettings).toEqual([
      { skillName: "workspace_only", enabled: true }
    ]);
    expect(effective.userContextHooks).toEqual([
      {
        id: "workspace-hook",
        event: "run_end",
        title: "Workspace",
        content: "workspace",
        enabled: true
      }
    ]);
  });

  test("merges legacy [hooks.*] workspace sections ahead of global hooks", async () => {
    const homeDir = await createHomeDir();
    const workspaceRoot = await createWorkspace();
    const store = createSettingsConfigStore({ homeDir });

    await store.updateGlobalSettings({
      userContextHooks: [
        {
          id: "global-run-start",
          event: "run_started",
          title: "Global start",
          content: "global start",
          enabled: true
        },
        {
          id: "global-run-end",
          event: "run_end",
          title: "Global end",
          content: "global end",
          enabled: true
        }
      ]
    });

    await writeWorkspaceConfig(
      workspaceRoot,
      [
        "[hooks.workspace_run_start]",
        'event = "run_started"',
        'title = "Workspace start"',
        'content = "workspace start"',
        "",
        "[hooks.workspace_run_end]",
        'event = "run_end"',
        'title = "Workspace end"',
        'content = "workspace end"'
      ].join("\n")
    );

    const effective = await store.getEffectiveSettings(workspaceRoot);

    expect(effective.userContextHooks).toEqual([
      {
        id: "workspace_run_end",
        event: "run_end",
        title: "Workspace end",
        content: "workspace end",
        enabled: true
      },
      {
        id: "workspace_run_start",
        event: "run_started",
        title: "Workspace start",
        content: "workspace start",
        enabled: true
      },
      {
        id: "global-run-start",
        event: "run_started",
        title: "Global start",
        content: "global start",
        enabled: false
      },
      {
        id: "global-run-end",
        event: "run_end",
        title: "Global end",
        content: "global end",
        enabled: false
      }
    ]);
  });
});
