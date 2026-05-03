import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadWorkspaceMcpConfig } from "../src/mcp/config-loader.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-mcp-config-"));
}

async function writeConfig(
  workspaceRoot: string,
  content: string
): Promise<void> {
  const agentDirectory = path.join(workspaceRoot, ".agents");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(path.join(agentDirectory, ".config.toml"), content, "utf8");
}

describe("loadWorkspaceMcpConfig", () => {
  test("returns an empty result when config is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      const result = await loadWorkspaceMcpConfig(workspaceRoot);

      expect(result.foundConfig).toBe(false);
      expect(result.servers).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("reports invalid TOML without throwing", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.bad
command = "node"
`.trim()
      );

      const result = await loadWorkspaceMcpConfig(workspaceRoot);

      expect(result.foundConfig).toBe(true);
      expect(result.servers).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe("invalid_toml");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("skips duplicate servers and invalid fields", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.good]
command = "node"
args = ["server.js"]

[mcp_servers.good]
command = "node"
args = ["duplicate.js"]

[mcp_servers.bad]
url = "https://example.com/mcp"
headers = { Authorization = 1 }
`.trim()
      );

      const result = await loadWorkspaceMcpConfig(workspaceRoot);

      expect(result.servers).toEqual([]);
      expect(result.diagnostics.map((item) => item.code)).toEqual(
        expect.arrayContaining(["duplicate_server", "invalid_field"])
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("parses stdio and HTTP server entries", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.local_echo]
command = "node"
args = ["server.js"]
env = { TOKEN = "abc" }

[mcp_servers.remote_echo]
url = "https://example.com/mcp"
headers = { Authorization = "Bearer token" }
`.trim()
      );

      const result = await loadWorkspaceMcpConfig(workspaceRoot);

      expect(result.diagnostics).toEqual([]);
      expect(result.servers).toEqual([
        {
          name: "local_echo",
          transport: "stdio",
          enabled: true,
          disabledTools: [],
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "abc" }
        },
        {
          name: "remote_echo",
          transport: "http",
          enabled: true,
          disabledTools: [],
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" }
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("resolves explicit stdio env references from the process environment", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const originalValue = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "fc-test-key";

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.firecrawl]
command = "npx"
args = ["-y", "firecrawl-mcp"]
env = { FIRECRAWL_API_KEY = "$FIRECRAWL_API_KEY" }
`.trim()
      );

      const result = await loadWorkspaceMcpConfig(workspaceRoot);

      expect(result.diagnostics).toEqual([]);
      expect(result.servers).toEqual([
        {
          name: "firecrawl",
          transport: "stdio",
          enabled: true,
          disabledTools: [],
          command: "npx",
          args: ["-y", "firecrawl-mcp"],
          env: { FIRECRAWL_API_KEY: "fc-test-key" }
        }
      ]);
    } finally {
      if (typeof originalValue === "string") {
        process.env.FIRECRAWL_API_KEY = originalValue;
      } else {
        delete process.env.FIRECRAWL_API_KEY;
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("parses MCP server and tool enabled state", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers.local_echo]
enabled = false
command = "node"
disabled_tools = ["echo", "status", "echo"]
`.trim()
      );

      const result = await loadWorkspaceMcpConfig(workspaceRoot);

      expect(result.diagnostics).toEqual([]);
      expect(result.servers).toEqual([
        {
          name: "local_echo",
          transport: "stdio",
          enabled: false,
          disabledTools: ["echo", "status"],
          command: "node",
          args: [],
          env: {}
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("normalizes shared MCP server defaults and trimmed fields", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[mcp_servers." local_echo "]
command = " node "
disabled_tools = [" echo ", "", "echo"]
`.trim()
      );

      const result = await loadWorkspaceMcpConfig(workspaceRoot);

      expect(result.diagnostics).toEqual([]);
      expect(result.servers).toEqual([
        {
          name: "local_echo",
          transport: "stdio",
          enabled: true,
          disabledTools: ["echo"],
          command: "node",
          args: [],
          env: {}
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
