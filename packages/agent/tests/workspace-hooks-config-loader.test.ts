import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadWorkspaceHookConfig,
  mergeWorkspaceAndSettingsUserContextHooks
} from "../src/workspace-hooks/index.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-hooks-config-"));
}

async function writeConfig(
  workspaceRoot: string,
  content: string
): Promise<void> {
  const agentDirectory = path.join(workspaceRoot, ".agents");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(path.join(agentDirectory, "config.toml"), content, "utf8");
}

describe("loadWorkspaceHookConfig", () => {
  test("returns an empty result when config is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      const result = await loadWorkspaceHookConfig(workspaceRoot);

      expect(result.foundConfig).toBe(false);
      expect(result.hooks).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("parses workspace hooks from keyed TOML sections", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[hooks.repo_context]
event = "run_started"
behavior = "context"
title = "Repo context"
content = "先读取仓库约定。"

[hooks.wrap_up]
event = "run_end"
behavior = "subagent"
wait_mode = "blocking"
max_turns = 250
title = "Wrap up"
content = "当前 run 结束后整理后续上下文。"
`.trim()
      );

      const result = await loadWorkspaceHookConfig(workspaceRoot);

      expect(result.diagnostics).toEqual([]);
      expect(result.hooks).toEqual([
        {
          id: "repo_context",
          event: "run_started",
          behavior: "context",
          title: "Repo context",
          content: "先读取仓库约定。",
          enabled: true
        },
        {
          id: "wrap_up",
          event: "run_end",
          behavior: "subagent",
          waitMode: "unblocking",
          maxTurns: 200,
          title: "Wrap up",
          content: "当前 run 结束后整理后续上下文。",
          enabled: true
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("reports invalid hook fields without throwing", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[hooks.good]
event = "session_started"
content = "会话启动时注入。"

[hooks.bad_event]
event = "before_everything"
content = "不会生效。"

[hooks.bad_wait_mode]
event = "run_started"
behavior = "message"
wait_mode = "blocking"
content = "wait mode 只适用于 subagent。"
`.trim()
      );

      const result = await loadWorkspaceHookConfig(workspaceRoot);

      expect(result.hooks.map((hook) => hook.id)).toEqual(["good"]);
      expect(result.diagnostics.map((item) => item.hookId)).toEqual([
        "bad_event",
        "bad_wait_mode"
      ]);
      expect(result.diagnostics.map((item) => item.code)).toEqual([
        "invalid_field",
        "invalid_field"
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("merges workspace hooks before settings hooks", () => {
    const merged = mergeWorkspaceAndSettingsUserContextHooks({
      workspaceHooks: [
        {
          id: "workspace-run-context",
          event: "run_started",
          behavior: "context",
          title: "Workspace",
          content: "优先使用 workspace hook。",
          enabled: true
        }
      ],
      settingsHooks: [
        {
          id: "settings-run-context",
          event: "run_started",
          behavior: "context",
          title: "Settings",
          content: "用户 settings 里的同类型 hook。",
          enabled: true
        },
        {
          id: "settings-run-message",
          event: "run_started",
          behavior: "message",
          title: "Settings message",
          content: "不同类型的 settings hook 仍然启用。",
          enabled: true
        }
      ]
    });

    expect(merged).toEqual([
      {
        id: "workspace-run-context",
        event: "run_started",
        behavior: "context",
        title: "Workspace",
        content: "优先使用 workspace hook。",
        enabled: true
      },
      {
        id: "settings-run-context",
        event: "run_started",
        behavior: "context",
        title: "Settings",
        content: "用户 settings 里的同类型 hook。",
        enabled: false
      },
      {
        id: "settings-run-message",
        event: "run_started",
        behavior: "message",
        title: "Settings message",
        content: "不同类型的 settings hook 仍然启用。",
        enabled: true
      }
    ]);
  });
});
