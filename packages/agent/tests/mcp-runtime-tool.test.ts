import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { loadWorkspaceMcpTools } from "../src/mcp/client-manager.js";
import { namespaceMcpToolName } from "../src/mcp/tool-adapter.js";
import { handlePendingPermissionReply } from "../src/runtime/permission.js";
import { executeToolAction } from "../src/runtime/tool-execution.js";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { ToolRegistry } from "../src/tools/registry.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-mcp-permission-"));
}

async function writeConfig(
  workspaceRoot: string,
  content: string
): Promise<void> {
  const agentDirectory = path.join(workspaceRoot, ".agent");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(path.join(agentDirectory, ".config.toml"), content, "utf8");
}

describe("MCP runtime tool integration", () => {
  test("MCP tools pause for approval and resume after confirmation", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
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
`.trim()
      );

      const mcpLoadResult = await loadWorkspaceMcpTools(workspaceRoot);
      const toolRegistry = new ToolRegistry();
      for (const tool of mcpLoadResult.tools) {
        toolRegistry.register(tool);
      }
      const toolName = namespaceMcpToolName("local_echo", "echo");

      try {
        const session = await sessionManager.createSession({
          workingDirectory: workspaceRoot,
          model: "MiniMax-M2.7",
          userId: "mcp-user"
        });

        const permissionRequest = await executeToolAction({
          sessionManager,
          routineRepository,
          toolRegistry,
          traceManager: undefined,
          session,
          turnCount: 1,
          toolCallId: "call-mcp",
          toolName,
          toolInput: {
            message: "hello"
          },
          eventSink: undefined
        });

        expect(permissionRequest.kind).toBe("permission_request");
        if (permissionRequest.kind !== "permission_request") {
          throw new Error("expected permission_request result");
        }
        expect(permissionRequest.request.family).toBe("mcp");
        expect(permissionRequest.request.toolName).toBe(toolName);

        const resumed = await handlePendingPermissionReply({
          sessionManager,
          routineRepository,
          toolRegistry,
          traceManager: undefined,
          session: permissionRequest.session,
          message: "确认",
          pendingPermissionRequest:
            permissionRequest.session.context.pendingPermissionRequest!,
          eventSink: undefined
        });

        expect(resumed?.kind).toBe("approved");
        if (resumed?.kind !== "approved") {
          throw new Error("expected approved reply result");
        }
        expect(resumed.toolOutputs[0]?.isError).toBe(false);
        expect(resumed.toolOutputs[0]?.content).toContain("echo:hello");
      } finally {
        await mcpLoadResult.dispose();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
