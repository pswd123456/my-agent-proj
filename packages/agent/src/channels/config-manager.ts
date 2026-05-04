import { promises as fs } from "node:fs";
import path from "node:path";

import { parse, stringify } from "smol-toml";

import {
  getWorkspaceChannelConfigPath,
  loadWorkspaceChannelConfig
} from "./config-loader.js";
import type {
  WorkspaceChannelConfigLoadResult,
  WorkspaceTelegramChannelConfig
} from "./config-types.js";

type TomlObject = Record<string, unknown>;

function isTomlObject(value: unknown): value is TomlObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readExistingConfigRoot(configPath: string): Promise<TomlObject> {
  let rawContent: string;
  try {
    rawContent = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  try {
    const parsed = parse(rawContent);
    return isTomlObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toTomlConfig(
  telegram: WorkspaceTelegramChannelConfig,
  existingRoot: TomlObject = {}
): string {
  const existingChannels = isTomlObject(existingRoot.channels)
    ? existingRoot.channels
    : {};
  const nextChannels = {
    ...existingChannels,
    telegram: {
      enabled: telegram.enabled,
      mode: telegram.mode,
      bot_token: telegram.botToken,
      ...(telegram.webhookSecret
        ? { webhook_secret: telegram.webhookSecret }
        : {}),
      ...(telegram.webhookUrl ? { webhook_url: telegram.webhookUrl } : {})
    }
  };

  return `${stringify({
    ...existingRoot,
    channels: nextChannels
  })}\n`;
}

export async function readManageableWorkspaceChannelConfig(
  workingDirectory: string
): Promise<WorkspaceChannelConfigLoadResult> {
  return loadWorkspaceChannelConfig(workingDirectory, {
    resolveEnvironment: false
  });
}

export async function replaceWorkspaceChannelConfig(
  workingDirectory: string,
  telegram: WorkspaceTelegramChannelConfig
): Promise<WorkspaceChannelConfigLoadResult> {
  const configPath = getWorkspaceChannelConfigPath(workingDirectory);
  const existingRoot = await readExistingConfigRoot(configPath);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, toTomlConfig(telegram, existingRoot), "utf8");
  return readManageableWorkspaceChannelConfig(workingDirectory);
}
