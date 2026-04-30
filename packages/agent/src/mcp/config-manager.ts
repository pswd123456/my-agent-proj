import { promises as fs } from "node:fs";
import path from "node:path";

import { stringify } from "smol-toml";

import type {
  WorkspaceMcpConfigLoadResult,
  WorkspaceMcpServerConfig
} from "./config-types.js";
import {
  getWorkspaceMcpConfigPath,
  loadWorkspaceMcpConfig
} from "./config-loader.js";

type TomlObject = Record<string, unknown>;

function toTomlConfig(servers: readonly WorkspaceMcpServerConfig[]): string {
  const mcpServers: Record<string, TomlObject> = {};

  for (const server of servers) {
    const disabledTools = server.disabledTools ?? [];
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

  return `${stringify({ mcp_servers: mcpServers })}\n`;
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
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, toTomlConfig(servers), "utf8");
  return readManageableWorkspaceMcpConfig(workingDirectory);
}
