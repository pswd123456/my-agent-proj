import type { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport";

import type { RuntimeTool } from "../tools/runtime-tool.js";
import { loadWorkspaceMcpConfig } from "./config-loader.js";
import type {
  WorkspaceMcpLoadResult,
  WorkspaceMcpServerConfig,
  WorkspaceMcpServerLoadSummary
} from "./config-types.js";
import {
  loadMcpSdkRuntime,
  type StdioClientTransport,
  type StreamableHTTPClientTransport
} from "./sdk-loader.js";
import { createMcpRuntimeTool } from "./tool-adapter.js";

interface ConnectedWorkspaceMcpServer {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: RuntimeTool[];
  summary: WorkspaceMcpServerLoadSummary;
}

async function closeServerConnection(input: {
  client: Client | undefined;
  transport: StdioClientTransport | StreamableHTTPClientTransport | undefined;
}
): Promise<void> {
  const sdk = await loadMcpSdkRuntime();
  try {
    if (input.transport instanceof sdk.StreamableHTTPClientTransport) {
      await input.transport.terminateSession().catch(() => undefined);
    }
  } catch {
    // Ignore cleanup failures.
  }

  try {
    await input.client?.close();
  } catch {
    // Ignore cleanup failures.
  }

  try {
    await input.transport?.close();
  } catch {
    // Ignore cleanup failures.
  }
}

async function createConnectedClient(): Promise<Client> {
  const sdk = await loadMcpSdkRuntime();
  return new sdk.Client(
    {
      name: "my-agent-proj-runtime",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
}

async function connectServer(
  workingDirectory: string,
  serverConfig: WorkspaceMcpServerConfig
): Promise<ConnectedWorkspaceMcpServer> {
  const sdk = await loadMcpSdkRuntime();
  const client = await createConnectedClient();
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined;

  try {
    transport =
      serverConfig.transport === "stdio"
        ? new sdk.StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args,
            env: {
              ...sdk.getDefaultEnvironment(),
              ...serverConfig.env
            },
            cwd: workingDirectory
          })
        : new sdk.StreamableHTTPClientTransport(new URL(serverConfig.url), {
            requestInit: {
              headers: serverConfig.headers
            }
          });

    await client.connect(transport as Transport);
    const listedTools = await client.listTools();
    const disabledTools = new Set(serverConfig.disabledTools);
    const toolEntries = listedTools.tools.map((definition) => {
      const runtimeTool = createMcpRuntimeTool({
        serverName: serverConfig.name,
        definition,
        client
      });
      const enabled = !disabledTools.has(definition.name);
      return {
        definition,
        runtimeTool,
        enabled
      };
    });
    const runtimeTools = toolEntries
      .filter((entry) => entry.enabled)
      .map((entry) => entry.runtimeTool);

    return {
      client,
      transport,
      tools: runtimeTools,
      summary: {
        name: serverConfig.name,
        transport: serverConfig.transport,
        status: "loaded",
        toolNames: runtimeTools.map((tool) => tool.name),
        tools: toolEntries.map((entry) => ({
          name: entry.definition.name,
          runtimeName: entry.runtimeTool.name,
          description:
            entry.definition.description?.trim() ||
            entry.definition.title?.trim() ||
            null,
          enabled: entry.enabled
        }))
      }
    };
  } catch (error) {
    await closeServerConnection({
      client,
      transport
    });
    throw error;
  }
}

export async function loadWorkspaceMcpTools(
  workingDirectory: string
): Promise<WorkspaceMcpLoadResult> {
  const config = await loadWorkspaceMcpConfig(workingDirectory);
  const connectedServers: ConnectedWorkspaceMcpServer[] = [];
  const summaries: WorkspaceMcpServerLoadSummary[] = [];

  for (const serverConfig of config.servers) {
    if (!serverConfig.enabled) {
      summaries.push({
        name: serverConfig.name,
        transport: serverConfig.transport,
        status: "disabled",
        toolNames: [],
        tools: []
      });
      continue;
    }

    try {
      const connected = await connectServer(workingDirectory, serverConfig);
      connectedServers.push(connected);
      summaries.push(connected.summary);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown MCP connection error.";
      summaries.push({
        name: serverConfig.name,
        transport: serverConfig.transport,
        status: "failed",
        toolNames: [],
        tools: [],
        error: message
      });
    }
  }

  const tools = connectedServers
    .flatMap((server) => server.tools)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    configPath: config.configPath,
    foundConfig: config.foundConfig,
    diagnostics: config.diagnostics,
    servers: summaries.sort((left, right) => left.name.localeCompare(right.name)),
    tools,
    async dispose() {
      await Promise.allSettled(
        connectedServers.map((server) =>
          closeServerConnection({
            client: server.client,
            transport: server.transport
          })
        )
      );
    }
  };
}
