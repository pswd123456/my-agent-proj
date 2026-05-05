import { mkdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  loadWorkspaceChannelConfig,
  readManageableWorkspaceChannelConfig,
  replaceWorkspaceChannelConfig
} from "../src/channels/index.js";

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "channel-config-"));
}

async function writeConfig(workspaceRoot: string, content: string) {
  const agentDirectory = path.join(workspaceRoot, ".agents");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(path.join(agentDirectory, "config.toml"), content, "utf8");
}

describe("workspace channel config", () => {
  test("loads telegram channel settings from config.toml", async () => {
    const workspaceRoot = await createWorkspace();
    await writeConfig(
      workspaceRoot,
      [
        "[channels.telegram]",
        "enabled = true",
        'mode = "polling"',
        'bot_token = "$TELEGRAM_BOT_TOKEN"',
        'webhook_secret = "$TELEGRAM_WEBHOOK_SECRET"',
        'webhook_url = "https://example.com/api/inbox/telegram/webhook"'
      ].join("\n")
    );

    const config = await readManageableWorkspaceChannelConfig(workspaceRoot);

    expect(config.telegram).toEqual({
      channel: "telegram",
      configuredInFile: true,
      enabled: true,
      mode: "polling",
      botToken: "$TELEGRAM_BOT_TOKEN",
      webhookSecret: "$TELEGRAM_WEBHOOK_SECRET",
      webhookUrl: "https://example.com/api/inbox/telegram/webhook"
    });
  });

  test("resolves environment references for runtime reads", async () => {
    const workspaceRoot = await createWorkspace();
    process.env.TEST_TELEGRAM_BOT_TOKEN = "runtime-token";
    await writeConfig(
      workspaceRoot,
      [
        "[channels.telegram]",
        "enabled = true",
        'bot_token = "$TEST_TELEGRAM_BOT_TOKEN"'
      ].join("\n")
    );

    const config = await loadWorkspaceChannelConfig(workspaceRoot);

    expect(config.telegram.botToken).toBe("runtime-token");
  });

  test("defaults telegram mode to polling when webhook url is absent", async () => {
    const workspaceRoot = await createWorkspace();
    await writeConfig(
      workspaceRoot,
      [
        "[channels.telegram]",
        "enabled = true",
        'bot_token = "$TELEGRAM_BOT_TOKEN"'
      ].join("\n")
    );

    const config = await readManageableWorkspaceChannelConfig(workspaceRoot);

    expect(config.telegram.mode).toBe("polling");
  });

  test("updates telegram channel settings and preserves other config roots", async () => {
    const workspaceRoot = await createWorkspace();
    await writeConfig(
      workspaceRoot,
      ["[mcp_servers.local]", 'command = "bun"', 'args = ["x", "tool"]'].join(
        "\n"
      )
    );

    await replaceWorkspaceChannelConfig(workspaceRoot, {
      channel: "telegram",
      configuredInFile: true,
      enabled: true,
      mode: "polling",
      botToken: "$TELEGRAM_BOT_TOKEN",
      webhookSecret: "$TELEGRAM_WEBHOOK_SECRET",
      webhookUrl: "https://example.com/webhook"
    });

    const rawContent = await readFile(
      path.join(workspaceRoot, ".agents", "config.toml"),
      "utf8"
    );

    expect(rawContent).toContain("[mcp_servers.local]");
    expect(rawContent).toContain("[channels.telegram]");
    expect(rawContent).toContain('mode = "polling"');
    expect(rawContent).toContain('bot_token = "$TELEGRAM_BOT_TOKEN"');
  });
});
