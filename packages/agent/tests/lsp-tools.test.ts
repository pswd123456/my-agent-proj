import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createLspServerManager } from "../src/lsp/index.js";
import { createLspTools } from "../src/tools/lsp.js";
import type {
  RuntimeTool,
  ToolExecutionContext
} from "../src/tools/runtime-tool.js";

const cleanupPaths = new Set<string>();

afterEach(async () => {
  for (const targetPath of cleanupPaths) {
    await rm(targetPath, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

describe("lsp tools", () => {
  test("loads TS hover, definition, references, symbols, and diagnostics", async () => {
    const workspace = await createTsWorkspace();
    const manager = createLspServerManager({
      workingDirectory: workspace,
      requestTimeoutMs: 10_000
    });
    const tools = toolMap(createLspTools({ workingDirectory: workspace, lspServerManager: manager }));
    const context = createContext(workspace);

    try {
      const hover = await tools.lsp_hover.execute(
        { path: "src/index.ts", line: 3, character: 1 },
        context
      );
      expect(hover.state).toBe("success");
      expect(JSON.stringify(hover.result.data)).toContain("greet");

      const definition = await tools.lsp_go_to_definition.execute(
        { path: "src/index.ts", line: 3, character: 1 },
        context
      );
      expect(definition.state).toBe("success");
      expect(JSON.stringify(definition.result.data)).toContain("greet");

      const references = await tools.lsp_find_references.execute(
        {
          path: "src/index.ts",
          line: 3,
          character: 1,
          includeDeclaration: true
        },
        context
      );
      expect(references.state).toBe("success");
      expect(JSON.stringify(references.result.data)).toContain("src/index.ts");

      const documentSymbols = await tools.lsp_document_symbols.execute(
        { path: "src/math.ts" },
        context
      );
      expect(documentSymbols.state).toBe("success");
      expect(JSON.stringify(documentSymbols.result.data)).toContain("greet");

      const workspaceSymbols = await tools.lsp_workspace_symbols.execute(
        { query: "greet", maxResults: 10 },
        context
      );
      expect(workspaceSymbols.state).toBe("success");
      expect(JSON.stringify(workspaceSymbols.result.data)).toContain("greet");

      const diagnostics = await tools.lsp_diagnostics.execute(
        { path: "src/index.ts" },
        context
      );
      expect(diagnostics.state).toBe("success");
      expect(JSON.stringify(diagnostics.result.data)).toContain("Type");
    } finally {
      await manager.dispose();
    }
  });

  test("rejects unsupported file extensions before server startup", async () => {
    const workspace = await createTsWorkspace();
    const manager = createLspServerManager({ workingDirectory: workspace });
    const tools = toolMap(createLspTools({ workingDirectory: workspace, lspServerManager: manager }));

    try {
      const validation = tools.lsp_hover.validate({
        path: "README.md",
        line: 1,
        character: 0
      });
      expect(validation.ok).toBe(false);

      const result = await tools.lsp_hover.execute(
        { path: "README.md", line: 1, character: 0 },
        createContext(workspace)
      );
      expect(result.state).toBe("failed");
      expect(result.result.code).toBe("INVALID_TOOL_INPUT");
    } finally {
      await manager.dispose();
    }
  });

  test("reports unavailable server after manager disposal", async () => {
    const workspace = await createTsWorkspace();
    const manager = createLspServerManager({ workingDirectory: workspace });
    const tools = toolMap(createLspTools({ workingDirectory: workspace, lspServerManager: manager }));

    await manager.dispose();
    const result = await tools.lsp_hover.execute(
      { path: "src/index.ts", line: 3, character: 1 },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("LSP_SERVER_UNAVAILABLE");
  });
});

async function createTsWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-lsp-"));
  cleanupPaths.add(workspace);
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(
    path.join(workspace, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler"
        },
        include: ["src/**/*.ts"]
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(workspace, "src", "math.ts"),
    [
      "export interface User {",
      "  name: string;",
      "}",
      "",
      "export function greet(user: User): string {",
      "  return user.name.toUpperCase();",
      "}",
      "",
      "export const answer = 42;",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(workspace, "src", "index.ts"),
    [
      'import { greet, type User } from "./math";',
      'const user: User = { name: "Ada" };',
      "greet(user);",
      'const broken: number = "oops";',
      ""
    ].join("\n")
  );
  return workspace;
}

function toolMap(tools: RuntimeTool[]): Record<string, RuntimeTool> {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function createContext(workingDirectory: string): ToolExecutionContext {
  return {
    sessionId: "session-lsp",
    userId: "user-lsp",
    workingDirectory,
    routineRepository: createMemoryRoutineRepository(),
    sessionManager: undefined as never,
    permissionRules: {
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionContext: {
      status: "running",
      currentDateContext: "2026-04-29",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionMessages: []
  };
}
