import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import type { Client } from "@modelcontextprotocol/sdk/client";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";

const require = createRequire(import.meta.url);

type ClientCtor = typeof import("@modelcontextprotocol/sdk/client")["Client"];
type StdioClientTransportCtor =
  typeof import("@modelcontextprotocol/sdk/client/stdio")["StdioClientTransport"];
type StreamableHTTPClientTransportCtor =
  typeof import("@modelcontextprotocol/sdk/client/streamableHttp")["StreamableHTTPClientTransport"];
type GetDefaultEnvironment = typeof import("@modelcontextprotocol/sdk/client/stdio")["getDefaultEnvironment"];
type McpServerCtor =
  typeof import("@modelcontextprotocol/sdk/server/mcp")["McpServer"];
type StdioServerTransportCtor =
  typeof import("@modelcontextprotocol/sdk/server/stdio")["StdioServerTransport"];
type StreamableHTTPServerTransportCtor =
  typeof import("@modelcontextprotocol/sdk/server/streamableHttp")["StreamableHTTPServerTransport"];

export interface LoadedMcpSdkRuntime {
  Client: ClientCtor;
  StdioClientTransport: StdioClientTransportCtor;
  StreamableHTTPClientTransport: StreamableHTTPClientTransportCtor;
  getDefaultEnvironment: GetDefaultEnvironment;
  McpServer: McpServerCtor;
  StdioServerTransport: StdioServerTransportCtor;
  StreamableHTTPServerTransport: StreamableHTTPServerTransportCtor;
}

let runtimeModulesPromise: Promise<LoadedMcpSdkRuntime> | null = null;

function toModuleHref(packageRoot: string, relativePath: string): string {
  return pathToFileURL(path.join(packageRoot, relativePath)).href;
}

export async function loadMcpSdkRuntime(): Promise<LoadedMcpSdkRuntime> {
  if (runtimeModulesPromise) {
    return runtimeModulesPromise;
  }

  runtimeModulesPromise = (async () => {
    const clientEntrypointPath = require.resolve("@modelcontextprotocol/sdk/client");
    const packageRoot = path.resolve(
      path.dirname(clientEntrypointPath),
      "../../.."
    );
    const [
      clientModule,
      stdioClientModule,
      httpClientModule,
      serverModule,
      stdioServerModule,
      httpServerModule
    ] = await Promise.all([
      import(toModuleHref(packageRoot, "dist/esm/client/index.js")),
      import(toModuleHref(packageRoot, "dist/esm/client/stdio.js")),
      import(toModuleHref(packageRoot, "dist/esm/client/streamableHttp.js")),
      import(toModuleHref(packageRoot, "dist/esm/server/mcp.js")),
      import(toModuleHref(packageRoot, "dist/esm/server/stdio.js")),
      import(toModuleHref(packageRoot, "dist/esm/server/streamableHttp.js"))
    ]);

    return {
      Client: clientModule.Client as ClientCtor,
      StdioClientTransport:
        stdioClientModule.StdioClientTransport as StdioClientTransportCtor,
      StreamableHTTPClientTransport:
        httpClientModule.StreamableHTTPClientTransport as StreamableHTTPClientTransportCtor,
      getDefaultEnvironment:
        stdioClientModule.getDefaultEnvironment as GetDefaultEnvironment,
      McpServer: serverModule.McpServer as McpServerCtor,
      StdioServerTransport:
        stdioServerModule.StdioServerTransport as StdioServerTransportCtor,
      StreamableHTTPServerTransport:
        httpServerModule.StreamableHTTPServerTransport as StreamableHTTPServerTransportCtor
    };
  })();

  return runtimeModulesPromise;
}

export type {
  Client,
  StdioClientTransport,
  StreamableHTTPClientTransport,
  McpServer,
  StdioServerTransport,
  StreamableHTTPServerTransport
};
