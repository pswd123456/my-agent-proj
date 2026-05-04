import { promises as fs } from "node:fs";
import path from "node:path";

import { parse, stringify } from "smol-toml";

import type {
  WorkspaceMcpConfigLoadResult,
  WorkspaceMcpServerConfig
} from "./config-types.js";
import { normalizeWorkspaceMcpServerConfigs } from "./config-normalization.js";
import {
  getWorkspaceMcpConfigPath,
  loadWorkspaceMcpConfig
} from "./config-loader.js";

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
  servers: readonly WorkspaceMcpServerConfig[],
  existingRoot: TomlObject = {}
): string {
  const mcpServers: Record<string, TomlObject> = {};
  const normalizedServers = normalizeWorkspaceMcpServerConfigs(servers);

  for (const server of normalizedServers) {
    const disabledTools = server.disabledTools;
    if (server.transport === "stdio") {
      mcpServers[server.name] = {
        ...(server.enabled === false ? { enabled: false } : {}),
        command: server.command,
        ...(server.args.length > 0 ? { args: server.args } : {}),
        ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
        ...(disabledTools.length > 0 ? { disabled_tools: disabledTools } : {})
      };
      continue;
    }

    mcpServers[server.name] = {
      ...(server.enabled === false ? { enabled: false } : {}),
      url: server.url,
      ...(Object.keys(server.headers).length > 0
        ? { headers: server.headers }
        : {}),
      ...(disabledTools.length > 0 ? { disabled_tools: disabledTools } : {})
    };
  }

  return `${stringify({ ...existingRoot, mcp_servers: mcpServers })}\n`;
}

export async function readManageableWorkspaceMcpConfig(
  workingDirectory: string
): Promise<WorkspaceMcpConfigLoadResult> {
  return loadWorkspaceMcpConfig(workingDirectory, {
    resolveEnvironment: false
  });
}

export async function replaceWorkspaceMcpConfigServers(
  workingDirectory: string,
  servers: readonly WorkspaceMcpServerConfig[]
): Promise<WorkspaceMcpConfigLoadResult> {
  const configPath = getWorkspaceMcpConfigPath(workingDirectory);
  const existingRoot = await readExistingConfigRoot(configPath);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, toTomlConfig(servers, existingRoot), "utf8");
  return readManageableWorkspaceMcpConfig(workingDirectory);
}
