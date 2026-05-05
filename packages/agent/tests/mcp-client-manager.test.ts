import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { loadWorkspaceMcpTools } from "../src/mcp/client-manager.js";
import { namespaceMcpToolName } from "../src/mcp/tool-adapter.js";
import { loadMcpSdkRuntime } from "../src/mcp/sdk-loader.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-mcp-runtime-"));
}

async function writeConfig(
  workspaceRoot: string,
  content: string
): Promise<void> {
  const agentDirectory = path.join(workspaceRoot, ".agents");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(path.join(agentDirectory, "config.toml"), content, "utf8");
}

async function createHttpMcpServer(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const { McpServer, StreamableHTTPServerTransport } =
    await loadMcpSdkRuntime();

  const server = createServer((request, response) => {
    void (async () => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      const mcpServer = new McpServer({
        name: "fixture-http",
        version: "1.0.0"
      });

      mcpServer.registerTool(
        "echo",
        {
          description: "Echo the provided message.",
          inputSchema: {
            message: z.string()
          }
        },
        async ({ message }) => ({
          content: [
            {
              type: "text",
              text: `http:${message}`
            }
          ]
        })
      );

      await mcpServer.connect(transport);
      await transport.handleRequest(request, response);
      response.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind HTTP MCP test server.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

describe("loadWorkspaceMcpTools", () => {
  test("loads stdio and HTTP MCP tools with namespaced tool names", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const httpServer = await createHttpMcpServer();
    const fixtureScript = path.resolve(
      import.meta.dir,
      "fixtures/mcp-echo-stdio.ts"
    );

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.local_echo]
command = "${process.execPath.replaceAll("\\", "\\\\")}"
args = ["${fixtureScript.replaceAll("\\", "\\\\")}"]

[mcp_servers.remote_echo]
url = "${httpServer.url}"
`.trim()
      );

      const result = await loadWorkspaceMcpTools(workspaceRoot);
      const localEchoTool = namespaceMcpToolName("local_echo", "echo");
      const remoteEchoTool = namespaceMcpToolName("remote_echo", "echo");

      try {
        expect(result.diagnostics).toEqual([]);
        expect(result.servers).toEqual([
          {
            name: "local_echo",
            transport: "stdio",
            status: "loaded",
            toolNames: [localEchoTool],
            tools: [
              {
                name: "echo",
                runtimeName: localEchoTool,
                description: "Echo the provided message.",
                enabled: true
              }
            ]
          },
          {
            name: "remote_echo",
            transport: "http",
            status: "loaded",
            toolNames: [remoteEchoTool],
            tools: [
              {
                name: "echo",
                runtimeName: remoteEchoTool,
                description: "Echo the provided message.",
                enabled: true
              }
            ]
          }
        ]);
        expect(result.tools.map((tool) => tool.name)).toEqual([
          localEchoTool,
          remoteEchoTool
        ]);
      } finally {
        await result.dispose();
      }
    } finally {
      await httpServer.close();
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("keeps loaded servers even when another server fails", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const fixtureScript = path.resolve(
      import.meta.dir,
      "fixtures/mcp-echo-stdio.ts"
    );

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.good]
command = "${process.execPath.replaceAll("\\", "\\\\")}"
args = ["${fixtureScript.replaceAll("\\", "\\\\")}"]

[mcp_servers.bad]
url = "http://127.0.0.1:1"
`.trim()
      );

      const result = await loadWorkspaceMcpTools(workspaceRoot);
      const goodEchoTool = namespaceMcpToolName("good", "echo");

      try {
        expect(result.tools.map((tool) => tool.name)).toEqual([goodEchoTool]);
        expect(result.servers).toEqual(
          expect.arrayContaining([
            {
              name: "good",
              transport: "stdio",
              status: "loaded",
              toolNames: [goodEchoTool],
              tools: [
                {
                  name: "echo",
                  runtimeName: goodEchoTool,
                  description: "Echo the provided message.",
                  enabled: true
                }
              ]
            },
            expect.objectContaining({
              name: "bad",
              transport: "http",
              status: "failed",
              toolNames: [],
              tools: []
            })
          ])
        );
      } finally {
        await result.dispose();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("keeps distinct tool names when raw MCP names normalize similarly", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const fixtureScript = path.resolve(
      import.meta.dir,
      "fixtures/mcp-echo-stdio.ts"
    );

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers."My-Server"]
command = "${process.execPath.replaceAll("\\", "\\\\")}"
args = ["${fixtureScript.replaceAll("\\", "\\\\")}"]

[mcp_servers.my_server]
command = "${process.execPath.replaceAll("\\", "\\\\")}"
args = ["${fixtureScript.replaceAll("\\", "\\\\")}"]
`.trim()
      );

      const result = await loadWorkspaceMcpTools(workspaceRoot);

      try {
        expect(result.servers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "My-Server", status: "loaded" }),
            expect.objectContaining({ name: "my_server", status: "loaded" })
          ])
        );
        const toolNames = result.tools.map((tool) => tool.name);
        expect(toolNames).toHaveLength(2);
        expect(new Set(toolNames).size).toBe(2);
      } finally {
        await result.dispose();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("skips disabled servers and disabled child tools", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const fixtureScript = path.resolve(
      import.meta.dir,
      "fixtures/mcp-echo-stdio.ts"
    );

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.disabled_server]
enabled = false
command = "${process.execPath.replaceAll("\\", "\\\\")}"
args = ["${fixtureScript.replaceAll("\\", "\\\\")}"]

[mcp_servers.local_echo]
command = "${process.execPath.replaceAll("\\", "\\\\")}"
args = ["${fixtureScript.replaceAll("\\", "\\\\")}"]
disabled_tools = ["echo"]
`.trim()
      );

      const result = await loadWorkspaceMcpTools(workspaceRoot);
      const localEchoTool = namespaceMcpToolName("local_echo", "echo");

      try {
        expect(result.tools).toEqual([]);
        expect(result.servers).toEqual(
          expect.arrayContaining([
            {
              name: "disabled_server",
              transport: "stdio",
              status: "disabled",
              toolNames: [],
              tools: []
            },
            {
              name: "local_echo",
              transport: "stdio",
              status: "loaded",
              toolNames: [],
              tools: [
                {
                  name: "echo",
                  runtimeName: localEchoTool,
                  description: "Echo the provided message.",
                  enabled: false
                }
              ]
            }
          ])
        );
      } finally {
        await result.dispose();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
