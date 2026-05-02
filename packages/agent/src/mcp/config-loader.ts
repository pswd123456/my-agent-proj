import { promises as fs } from "node:fs";
import path from "node:path";

import { parse, TomlError } from "smol-toml";

import type {
  WorkspaceMcpConfigDiagnostic,
  WorkspaceMcpConfigLoadResult,
  WorkspaceMcpHttpServerConfig,
  WorkspaceMcpServerConfig,
  WorkspaceMcpStdioServerConfig
} from "./config-types.js";
import {
  normalizeWorkspaceMcpDisabledTools,
  normalizeWorkspaceMcpServerConfig
} from "./config-normalization.js";

const MCP_CONFIG_DIRECTORY = ".agent";
const MCP_CONFIG_FILE_NAME = ".config.toml";

export interface WorkspaceMcpConfigLoadOptions {
  resolveEnvironment?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getWorkspaceMcpConfigPath(workingDirectory: string): string {
  return path.join(
    path.resolve(workingDirectory),
    MCP_CONFIG_DIRECTORY,
    MCP_CONFIG_FILE_NAME
  );
}

function collectDuplicateServerNames(rawContent: string): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const pattern = /^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^\]]+))\]\s*$/gm;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(rawContent)) !== null) {
    const serverName = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!serverName) {
      continue;
    }
    if (seen.has(serverName)) {
      duplicates.add(serverName);
      continue;
    }
    seen.add(serverName);
  }
  return duplicates;
}

function stripDuplicateServerSections(rawContent: string): string {
  const lines = rawContent.split(/\r?\n/);
  const seenServerNames = new Set<string>();
  let skippedServerName: string | null = null;
  const keptLines: string[] = [];

  for (const line of lines) {
    const headerMatch =
      line.match(
        /^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^\].]+))\]\s*$/
      ) ?? null;
    const anyHeaderMatch = line.match(/^\s*\[([^\]]+)\]\s*$/) ?? null;

    if (headerMatch) {
      const serverName = (
        headerMatch[1] ??
        headerMatch[2] ??
        headerMatch[3] ??
        ""
      ).trim();
      if (seenServerNames.has(serverName)) {
        skippedServerName = serverName;
        continue;
      }
      seenServerNames.add(serverName);
      skippedServerName = null;
      keptLines.push(line);
      continue;
    }

    if (anyHeaderMatch) {
      const headerPath = anyHeaderMatch[1]?.trim() ?? "";
      if (
        skippedServerName &&
        (headerPath === `mcp_servers.${skippedServerName}` ||
          headerPath.startsWith(`mcp_servers.${skippedServerName}.`))
      ) {
        continue;
      }
      skippedServerName = null;
      keptLines.push(line);
      continue;
    }

    if (skippedServerName) {
      continue;
    }
    keptLines.push(line);
  }

  return keptLines.join("\n");
}

function buildDiagnostic(
  diagnostic: WorkspaceMcpConfigDiagnostic
): WorkspaceMcpConfigDiagnostic {
  return diagnostic;
}

function validateStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!value.every((item) => typeof item === "string")) {
    return null;
  }

  return value;
}

function validateOptionalEnabled(
  serverName: string,
  value: Record<string, unknown>
): boolean | WorkspaceMcpConfigDiagnostic {
  if (typeof value.enabled === "undefined") {
    return true;
  }

  if (typeof value.enabled !== "boolean") {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "MCP server enabled must be a boolean."
    });
  }

  return value.enabled;
}

function validateOptionalDisabledTools(
  serverName: string,
  value: Record<string, unknown>
): string[] | WorkspaceMcpConfigDiagnostic {
  if (typeof value.disabled_tools === "undefined") {
    return [];
  }

  const disabledTools = validateStringArray(value.disabled_tools);
  if (!disabledTools) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "MCP server disabled_tools must be an array of strings."
    });
  }

  return normalizeWorkspaceMcpDisabledTools(disabledTools);
}

function validateStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }

  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      return null;
    }
    next[key] = item;
  }

  return next;
}

const ENV_REFERENCE_PATTERN =
  /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;

function resolveEnvironmentReferences(
  record: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const match = value.match(ENV_REFERENCE_PATTERN);
    const envName = match?.[1] ?? match?.[2];
    next[key] =
      envName && typeof process.env[envName] === "string"
        ? process.env[envName]
        : value;
  }
  return next;
}

function validateUnknownFields(
  serverName: string,
  value: Record<string, unknown>,
  allowedKeys: string[]
): WorkspaceMcpConfigDiagnostic | null {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length === 0) {
    return null;
  }

  return buildDiagnostic({
    scope: "server",
    code: "invalid_field",
    serverName,
    message: `Unsupported fields in MCP server config: ${unknownKeys.join(", ")}`
  });
}

function parseStdioServer(
  serverName: string,
  value: Record<string, unknown>,
  options?: WorkspaceMcpConfigLoadOptions
): WorkspaceMcpStdioServerConfig | WorkspaceMcpConfigDiagnostic {
  const unknownFields = validateUnknownFields(serverName, value, [
    "command",
    "args",
    "env",
    "enabled",
    "disabled_tools"
  ]);
  if (unknownFields) {
    return unknownFields;
  }

  const enabled = validateOptionalEnabled(serverName, value);
  if (typeof enabled !== "boolean") {
    return enabled;
  }

  const disabledTools = validateOptionalDisabledTools(serverName, value);
  if (!Array.isArray(disabledTools)) {
    return disabledTools;
  }

  if (typeof value.command !== "string" || value.command.trim().length === 0) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "stdio MCP server requires a non-empty command string."
    });
  }

  const args =
    typeof value.args === "undefined" ? [] : validateStringArray(value.args);
  if (!args) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "stdio MCP server args must be an array of strings."
    });
  }

  const env =
    typeof value.env === "undefined" ? {} : validateStringRecord(value.env);
  if (!env) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "stdio MCP server env must be a string-to-string table."
    });
  }

  return normalizeWorkspaceMcpServerConfig({
    name: serverName,
    transport: "stdio",
    enabled,
    disabledTools,
    command: value.command,
    args,
    env:
      options?.resolveEnvironment === false
        ? env
        : resolveEnvironmentReferences(env)
  });
}

function parseHttpServer(
  serverName: string,
  value: Record<string, unknown>
): WorkspaceMcpHttpServerConfig | WorkspaceMcpConfigDiagnostic {
  const unknownFields = validateUnknownFields(serverName, value, [
    "url",
    "headers",
    "enabled",
    "disabled_tools"
  ]);
  if (unknownFields) {
    return unknownFields;
  }

  const enabled = validateOptionalEnabled(serverName, value);
  if (typeof enabled !== "boolean") {
    return enabled;
  }

  const disabledTools = validateOptionalDisabledTools(serverName, value);
  if (!Array.isArray(disabledTools)) {
    return disabledTools;
  }

  if (typeof value.url !== "string" || value.url.trim().length === 0) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "HTTP MCP server requires a non-empty url string."
    });
  }

  try {
    const parsedUrl = new URL(value.url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return buildDiagnostic({
        scope: "server",
        code: "invalid_field",
        serverName,
        message: "HTTP MCP server url must use http or https."
      });
    }
  } catch {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "HTTP MCP server url must be a valid absolute URL."
    });
  }

  const headers =
    typeof value.headers === "undefined"
      ? {}
      : validateStringRecord(value.headers);
  if (!headers) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_field",
      serverName,
      message: "HTTP MCP server headers must be a string-to-string table."
    });
  }

  return normalizeWorkspaceMcpServerConfig({
    name: serverName,
    transport: "http",
    enabled,
    disabledTools,
    url: value.url,
    headers
  });
}

function parseServerConfig(
  serverName: string,
  rawValue: unknown,
  options?: WorkspaceMcpConfigLoadOptions
): WorkspaceMcpServerConfig | WorkspaceMcpConfigDiagnostic {
  if (!isRecord(rawValue)) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_server",
      serverName,
      message: "MCP server config must be a table."
    });
  }

  const hasCommand = Object.prototype.hasOwnProperty.call(rawValue, "command");
  const hasUrl = Object.prototype.hasOwnProperty.call(rawValue, "url");
  if (hasCommand === hasUrl) {
    return buildDiagnostic({
      scope: "server",
      code: "invalid_server",
      serverName,
      message:
        "MCP server config must declare either stdio command or HTTP url, but not both."
    });
  }

  return hasCommand
    ? parseStdioServer(serverName, rawValue, options)
    : parseHttpServer(serverName, rawValue);
}

export async function loadWorkspaceMcpConfig(
  workingDirectory: string,
  options?: WorkspaceMcpConfigLoadOptions
): Promise<WorkspaceMcpConfigLoadResult> {
  const configPath = getWorkspaceMcpConfigPath(workingDirectory);

  let rawContent: string;
  try {
    rawContent = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        configPath,
        foundConfig: false,
        servers: [],
        diagnostics: []
      };
    }
    throw error;
  }

  const diagnostics: WorkspaceMcpConfigDiagnostic[] = [];
  const duplicateServerNames = collectDuplicateServerNames(rawContent);
  for (const serverName of [...duplicateServerNames].sort()) {
    diagnostics.push(
      buildDiagnostic({
        scope: "server",
        code: "duplicate_server",
        serverName,
        message: `Duplicate MCP server section ignored: ${serverName}`
      })
    );
  }

  let parsed: unknown;
  try {
    parsed = parse(
      duplicateServerNames.size === 0
        ? rawContent
        : stripDuplicateServerSections(rawContent)
    );
  } catch (error) {
    const message =
      error instanceof TomlError || error instanceof Error
        ? error.message
        : "Unknown TOML parse error.";
    return {
      configPath,
      foundConfig: true,
      servers: [],
      diagnostics: [
        buildDiagnostic({
          scope: "file",
          code: "invalid_toml",
          message
        })
      ]
    };
  }

  if (!isRecord(parsed)) {
    return {
      configPath,
      foundConfig: true,
      servers: [],
      diagnostics: [
        buildDiagnostic({
          scope: "file",
          code: "invalid_root",
          message: "MCP config root must be a TOML table."
        })
      ]
    };
  }

  const root = parsed.mcp_servers;
  if (typeof root === "undefined") {
    return {
      configPath,
      foundConfig: true,
      servers: [],
      diagnostics
    };
  }

  if (!isRecord(root)) {
    return {
      configPath,
      foundConfig: true,
      servers: [],
      diagnostics: [
        ...diagnostics,
        buildDiagnostic({
          scope: "file",
          code: "invalid_root",
          message: "mcp_servers must be a TOML table."
        })
      ]
    };
  }

  const servers: WorkspaceMcpServerConfig[] = [];
  for (const serverName of Object.keys(root).sort()) {
    if (duplicateServerNames.has(serverName)) {
      continue;
    }

    const parsedServer = parseServerConfig(
      serverName,
      root[serverName],
      options
    );
    if ("transport" in parsedServer) {
      servers.push(parsedServer);
      continue;
    }

    diagnostics.push(parsedServer);
  }

  return {
    configPath,
    foundConfig: true,
    servers,
    diagnostics
  };
}
