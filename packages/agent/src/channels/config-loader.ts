import { promises as fs } from "node:fs";

import { parse, TomlError } from "smol-toml";

import { getWorkspaceAgentConfigPath } from "../workspace-config/index.js";
import type {
  WorkspaceChannelConfigDiagnostic,
  WorkspaceChannelConfigLoadResult,
  WorkspaceTelegramChannelConfig
} from "./config-types.js";

export interface WorkspaceChannelConfigLoadOptions {
  resolveEnvironment?: boolean;
}

const ENV_REFERENCE_PATTERN =
  /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createDefaultTelegramConfig(): WorkspaceTelegramChannelConfig {
  return {
    channel: "telegram",
    configuredInFile: false,
    enabled: false,
    mode: "polling",
    botToken: "",
    webhookSecret: "",
    webhookUrl: ""
  };
}

function normalizeTelegramMode(
  value: unknown,
  webhookUrl: string,
  diagnostics: WorkspaceChannelConfigDiagnostic[]
): WorkspaceTelegramChannelConfig["mode"] {
  if (value === "polling" || value === "webhook") {
    return value;
  }
  if (typeof value === "undefined") {
    return webhookUrl ? "webhook" : "polling";
  }
  diagnostics.push({
    scope: "channel",
    code: "invalid_channel",
    channelName: "telegram",
    message: "Telegram channel mode must be polling or webhook."
  });
  return "polling";
}

function resolveEnvironmentReference(value: string): string {
  const match = value.match(ENV_REFERENCE_PATTERN);
  const envName = match?.[1] ?? match?.[2];
  return envName && typeof process.env[envName] === "string"
    ? (process.env[envName] ?? value)
    : value;
}

function normalizeOptionalString(
  value: unknown,
  options?: WorkspaceChannelConfigLoadOptions
): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return options?.resolveEnvironment === false
    ? trimmed
    : resolveEnvironmentReference(trimmed);
}

function parseTelegramChannel(
  value: unknown,
  diagnostics: WorkspaceChannelConfigDiagnostic[],
  options?: WorkspaceChannelConfigLoadOptions
): WorkspaceTelegramChannelConfig {
  const defaults = createDefaultTelegramConfig();
  if (typeof value === "undefined") {
    return defaults;
  }
  if (!isRecord(value)) {
    diagnostics.push({
      scope: "channel",
      code: "invalid_channel",
      channelName: "telegram",
      message: "Telegram channel config must be a TOML table."
    });
    return defaults;
  }

  const webhookUrl = normalizeOptionalString(value.webhook_url, options);
  return {
    channel: "telegram",
    configuredInFile: true,
    enabled:
      typeof value.enabled === "boolean"
        ? value.enabled
        : Boolean(normalizeOptionalString(value.bot_token, options)),
    mode: normalizeTelegramMode(value.mode, webhookUrl, diagnostics),
    botToken: normalizeOptionalString(value.bot_token, options),
    webhookSecret: normalizeOptionalString(value.webhook_secret, options),
    webhookUrl
  };
}

export function getWorkspaceChannelConfigPath(
  workingDirectory: string
): string {
  return getWorkspaceAgentConfigPath(workingDirectory);
}

export async function loadWorkspaceChannelConfig(
  workingDirectory: string,
  options: WorkspaceChannelConfigLoadOptions = {}
): Promise<WorkspaceChannelConfigLoadResult> {
  const configPath = getWorkspaceChannelConfigPath(workingDirectory);
  let rawContent: string;
  try {
    rawContent = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        configPath,
        foundConfig: false,
        telegram: createDefaultTelegramConfig(),
        diagnostics: []
      };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parse(rawContent);
  } catch (error) {
    return {
      configPath,
      foundConfig: true,
      telegram: createDefaultTelegramConfig(),
      diagnostics: [
        {
          scope: "file",
          code: "invalid_toml",
          message:
            error instanceof TomlError
              ? error.message
              : "Unknown TOML parse error."
        }
      ]
    };
  }

  if (!isRecord(parsed)) {
    return {
      configPath,
      foundConfig: true,
      telegram: createDefaultTelegramConfig(),
      diagnostics: [
        {
          scope: "file",
          code: "invalid_root",
          message: "Workspace channel config root must be a TOML table."
        }
      ]
    };
  }

  const diagnostics: WorkspaceChannelConfigDiagnostic[] = [];
  const channels = parsed.channels;
  if (typeof channels !== "undefined" && !isRecord(channels)) {
    diagnostics.push({
      scope: "file",
      code: "invalid_root",
      message: "channels must be a TOML table."
    });
  }

  return {
    configPath,
    foundConfig: true,
    telegram: parseTelegramChannel(
      isRecord(channels) ? channels.telegram : undefined,
      diagnostics,
      options
    ),
    diagnostics
  };
}
