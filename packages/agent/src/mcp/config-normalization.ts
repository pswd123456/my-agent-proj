import type {
  WorkspaceMcpHttpServerConfig,
  WorkspaceMcpServerConfig,
  WorkspaceMcpStdioServerConfig
} from "./config-types.js";

type WorkspaceMcpBaseServerConfigInput = {
  name: string;
  enabled?: boolean | undefined;
  disabledTools?: readonly string[] | undefined;
};

export type WorkspaceMcpStdioServerConfigInput =
  WorkspaceMcpBaseServerConfigInput & {
    transport: "stdio";
    command: string;
    args?: readonly string[] | undefined;
    env?: Readonly<Record<string, string>> | undefined;
  };

export type WorkspaceMcpHttpServerConfigInput =
  WorkspaceMcpBaseServerConfigInput & {
    transport: "http";
    url: string;
    headers?: Readonly<Record<string, string>> | undefined;
  };

export type WorkspaceMcpServerConfigInput =
  | WorkspaceMcpStdioServerConfigInput
  | WorkspaceMcpHttpServerConfigInput;

export function normalizeWorkspaceMcpServerName(name: string): string {
  return name.trim();
}

export function normalizeWorkspaceMcpDisabledTools(
  disabledTools?: readonly string[] | undefined
): string[] {
  return [...new Set((disabledTools ?? []).map((tool) => tool.trim()).filter(Boolean))];
}

function cloneStringRecord(
  record?: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  return record ? { ...record } : {};
}

export function normalizeWorkspaceMcpServerConfig(
  server: WorkspaceMcpStdioServerConfigInput
): WorkspaceMcpStdioServerConfig;
export function normalizeWorkspaceMcpServerConfig(
  server: WorkspaceMcpHttpServerConfigInput
): WorkspaceMcpHttpServerConfig;
export function normalizeWorkspaceMcpServerConfig(
  server: WorkspaceMcpServerConfigInput
): WorkspaceMcpServerConfig {
  const name = normalizeWorkspaceMcpServerName(server.name);
  const enabled = server.enabled ?? true;
  const disabledTools = normalizeWorkspaceMcpDisabledTools(
    server.disabledTools
  );

  if (server.transport === "stdio") {
    return {
      name,
      transport: "stdio",
      enabled,
      disabledTools,
      command: server.command.trim(),
      args: server.args ? [...server.args] : [],
      env: cloneStringRecord(server.env)
    };
  }

  return {
    name,
    transport: "http",
    enabled,
    disabledTools,
    url: server.url.trim(),
    headers: cloneStringRecord(server.headers)
  };
}

export function normalizeWorkspaceMcpServerConfigs(
  servers: readonly WorkspaceMcpServerConfigInput[]
): WorkspaceMcpServerConfig[] {
  return servers.map((server) => {
    if (server.transport === "stdio") {
      return normalizeWorkspaceMcpServerConfig(server);
    }

    return normalizeWorkspaceMcpServerConfig(server);
  });
}

export function findDuplicateWorkspaceMcpServerNames(
  servers: readonly Pick<WorkspaceMcpServerConfigInput, "name">[]
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const server of servers) {
    const name = normalizeWorkspaceMcpServerName(server.name);
    if (!name) {
      continue;
    }
    if (seen.has(name)) {
      duplicates.add(name);
      continue;
    }
    seen.add(name);
  }

  return [...duplicates].sort();
}
