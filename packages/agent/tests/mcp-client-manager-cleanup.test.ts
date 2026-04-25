import { describe, expect, mock, test } from "bun:test";

describe("loadWorkspaceMcpTools cleanup", () => {
  test("closes partially opened MCP clients and transports after startup failures", async () => {
    const closeCalls = {
      client: 0,
      transport: 0,
      terminateSession: 0
    };

    class FakeHttpTransport {
      constructor(
        readonly _url: URL,
        readonly _options: { requestInit?: { headers?: Record<string, string> } }
      ) {}

      async terminateSession() {
        closeCalls.terminateSession += 1;
      }

      async close() {
        closeCalls.transport += 1;
      }
    }

    class FakeClient {
      constructor(
        readonly _identity: { name: string; version: string },
        readonly _options: { capabilities: Record<string, never> }
      ) {}

      async connect() {
        throw new Error("mock connect failure");
      }

      async close() {
        closeCalls.client += 1;
      }
    }

    mock.module("../src/mcp/config-loader.js", () => ({
      loadWorkspaceMcpConfig: async () => ({
        configPath: "/tmp/.agent/.config.toml",
        foundConfig: true,
        diagnostics: [],
        servers: [
          {
            name: "broken_http",
            transport: "http" as const,
            url: "https://example.com/mcp",
            headers: {}
          }
        ]
      })
    }));

    mock.module("../src/mcp/sdk-loader.js", () => ({
      loadMcpSdkRuntime: async () => ({
        Client: FakeClient,
        StdioClientTransport: class FakeStdioTransport {
          async close() {
            closeCalls.transport += 1;
          }
        },
        StreamableHTTPClientTransport: FakeHttpTransport,
        getDefaultEnvironment: () => ({})
      })
    }));

    const { loadWorkspaceMcpTools } = await import(
      `../src/mcp/client-manager.js?cleanup-test=${Date.now()}`
    );

    const result = await loadWorkspaceMcpTools("/tmp/mock-workspace");
    expect(result.servers).toEqual([
      expect.objectContaining({
        name: "broken_http",
        status: "failed",
        error: "mock connect failure"
      })
    ]);
    expect(closeCalls).toEqual({
      client: 1,
      transport: 1,
      terminateSession: 1
    });
  });
});
