import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSearchTextTool } from "../src/tools/search-text.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

const cleanupPaths = new Set<string>();

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "search-text-"));
  cleanupPaths.add(workspace);
  return workspace;
}

function createContext(workingDirectory: string): ToolExecutionContext {
  return {
    sessionId: "session-1",
    userId: "user-1",
    workingDirectory,
    routineRepository: undefined as never,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-04-24",
      yoloMode: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    permissionRules: {
      shell: {
        allow: [],
        ask: [],
        deny: []
      },
      tools: {
        allow: [],
        ask: [],
        deny: []
      }
    }
  };
}

afterEach(async () => {
  await Promise.all(
    [...cleanupPaths].map((targetPath) =>
      rm(targetPath, { recursive: true, force: true })
    )
  );
  cleanupPaths.clear();
});

describe("search_text", () => {
  test("searches literal text and returns structured matches", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "notes.txt"),
      "alpha\nneedle.* literal\nneedle.* again\n"
    );
    await writeFile(path.join(workspace, "other.txt"), "needleZ not matched\n");

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "needle.*",
        maxResults: 5
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      root: "",
      query: "needle.*",
      truncated: false,
      matches: [
        {
          path: "notes.txt",
          line: 2,
          snippet: "needle.* literal"
        },
        {
          path: "notes.txt",
          line: 3,
          snippet: "needle.* again"
        }
      ]
    });
  });

  test("respects maxResults and ignored directories", async () => {
    const workspace = await createWorkspace();
    await mkdir(path.join(workspace, "src"));
    await mkdir(path.join(workspace, "node_modules"));
    await writeFile(path.join(workspace, "src", "a.txt"), "needle one\n");
    await writeFile(path.join(workspace, "src", "b.txt"), "needle two\n");
    await writeFile(path.join(workspace, "node_modules", "hidden.txt"), "needle hidden\n");

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "needle",
        maxResults: 1
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      truncated: true
    });
    expect(result.result.data?.matches).toHaveLength(1);
    expect(JSON.stringify(result.result.data)).not.toContain("node_modules");
  });

  test("supports regular expression queries when requested", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "needle-123\nneedle-abc\n");

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "needle-[0-9]+",
        regex: true,
        maxResults: 5
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      regex: true,
      matches: [
        {
          path: "notes.txt",
          line: 1,
          snippet: "needle-123"
        }
      ]
    });
  });
});
