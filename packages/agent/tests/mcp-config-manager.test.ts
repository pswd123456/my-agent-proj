import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadWorkspaceHookConfig,
  readManageableWorkspaceMcpConfig,
  replaceWorkspaceMcpConfigServers
} from "../src/index.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-mcp-manager-"));
}

async function writeConfig(
  workspaceRoot: string,
  content: string
): Promise<void> {
  const agentDirectory = path.join(workspaceRoot, ".agents");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(path.join(agentDirectory, ".config.toml"), content, "utf8");
}

describe("replaceWorkspaceMcpConfigServers", () => {
  test("preserves workspace hook sections when rewriting MCP servers", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeConfig(
        workspaceRoot,
        `
[hooks.repo_context]
event = "run_started"
behavior = "context"
title = "Repo context"
content = "先读取仓库约定。"

[mcp_servers.old]
command = "node"
args = ["old.js"]
`.trim()
      );

      const mcpResult = await replaceWorkspaceMcpConfigServers(workspaceRoot, [
        {
          name: "new",
          transport: "stdio",
          enabled: true,
          disabledTools: [],
          command: "bun",
          args: ["server.ts"],
          env: {}
        }
      ]);
      const hookResult = await loadWorkspaceHookConfig(workspaceRoot);
      const manageable = await readManageableWorkspaceMcpConfig(workspaceRoot);
      const rawConfig = await readFile(
        path.join(workspaceRoot, ".agents", ".config.toml"),
        "utf8"
      );

      expect(mcpResult.diagnostics).toEqual([]);
      expect(manageable.servers.map((server) => server.name)).toEqual(["new"]);
      expect(hookResult.hooks.map((hook) => hook.id)).toEqual(["repo_context"]);
      expect(rawConfig).toContain("[hooks.repo_context]");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
