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
  const agentDirectory = path.join(workspaceRoot, ".agent");
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
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "abc" }
        },
        {
          name: "remote_echo",
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token" }
        }
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
