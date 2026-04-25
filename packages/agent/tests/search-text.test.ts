import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSearchTextTool } from "../src/tools/search-text.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";
import type { ConversationBlock } from "../src/types.js";

const cleanupPaths = new Set<string>();

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "search-text-"));
  cleanupPaths.add(workspace);
  return workspace;
}

function createToolCallBlock(input: {
  toolCallId: string;
  toolInput: Record<string, string | number | boolean | null>;
}): ConversationBlock {
  return {
    id: input.toolCallId,
    kind: "tool call",
    toolCallId: input.toolCallId,
    toolName: "search_text",
    input: input.toolInput,
    state: "pending",
    createdAt: new Date().toISOString()
  };
}

function createContext(
  workingDirectory: string,
  options: {
    sessionMessages?: ConversationBlock[];
  } = {}
): ToolExecutionContext {
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
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    permissionRules: {
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionMessages: options.sessionMessages ?? []
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
      outputMode: "content",
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
    await writeFile(
      path.join(workspace, "node_modules", "hidden.txt"),
      "needle hidden\n"
    );

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
    await writeFile(
      path.join(workspace, "notes.txt"),
      "needle-123\nneedle-abc\n"
    );

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

  test("returns a structured error for invalid regular expressions", async () => {
    const workspace = await createWorkspace();

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "(",
        regex: true
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_REGEX");
  });

  test("supports searching within a single file path", async () => {
    const workspace = await createWorkspace();
    await mkdir(path.join(workspace, "src"));
    await writeFile(path.join(workspace, "src", "target.txt"), "needle here\n");
    await writeFile(
      path.join(workspace, "src", "other.txt"),
      "needle elsewhere\n"
    );

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "needle",
        path: "src/target.txt",
        maxResults: 5
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      root: "src/target.txt",
      matches: [
        {
          path: "src/target.txt",
          line: 1,
          snippet: "needle here"
        }
      ]
    });
  });

  test("supports pipe-separated literal keywords as OR conditions", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "notes.txt"),
      "alpha value\nbeta value\ngamma value\n"
    );

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "alpha | gamma",
        maxResults: 5
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      regex: false,
      matches: [
        {
          path: "notes.txt",
          line: 1,
          snippet: "alpha value"
        },
        {
          path: "notes.txt",
          line: 3,
          snippet: "gamma value"
        }
      ]
    });
  });

  test("supports escaped pipes in literal queries", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "notes.txt"),
      "alpha|beta\nalpha beta\n"
    );

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "alpha\\|beta",
        maxResults: 5
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      matches: [
        {
          path: "notes.txt",
          line: 1,
          snippet: "alpha|beta"
        }
      ]
    });
  });

  test("supports case-insensitive search, file globs, and surrounding context", async () => {
    const workspace = await createWorkspace();
    await mkdir(path.join(workspace, "src"));
    await writeFile(
      path.join(workspace, "src", "target.ts"),
      "first\nNeedle line\nthird\n"
    );
    await writeFile(
      path.join(workspace, "src", "target.txt"),
      "needle but filtered out\n"
    );

    const result = await createSearchTextTool(workspace).execute(
      {
        query: "needle",
        path: "src",
        fileGlob: "**/*.ts",
        caseSensitive: false,
        contextLines: 1
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      caseSensitive: false,
      fileGlob: "**/*.ts",
      matches: [
        {
          path: "src/target.ts",
          line: 2,
          snippet: "Needle line",
          contextBefore: ["first"],
          contextAfter: ["third"]
        }
      ]
    });
  });

  test("supports files_only and count output modes with offset", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "a.txt"), "needle one\nneedle two\n");
    await writeFile(path.join(workspace, "b.txt"), "needle three\n");

    const filesOnly = await createSearchTextTool(workspace).execute(
      {
        query: "needle",
        outputMode: "files_only",
        offset: 1,
        maxResults: 2
      },
      createContext(workspace)
    );

    expect(filesOnly.state).toBe("success");
    expect(filesOnly.result.data).toMatchObject({
      outputMode: "files_only",
      files: [
        { path: "a.txt", matchCount: 1 },
        { path: "b.txt", matchCount: 1 }
      ]
    });

    const countOnly = await createSearchTextTool(workspace).execute(
      {
        query: "needle",
        outputMode: "count"
      },
      createContext(workspace)
    );

    expect(countOnly.state).toBe("success");
    expect(countOnly.result.data).toMatchObject({
      outputMode: "count",
      matchCount: 3,
      fileCount: 2
    });
    expect(countOnly.result.data?.matches).toBeUndefined();
  });

  test("warns and then blocks repeated search loops", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "needle\n");

    const warningResult = await createSearchTextTool(workspace).execute(
      {
        query: "needle"
      },
      createContext(workspace, {
        sessionMessages: [
          createToolCallBlock({
            toolCallId: "call-1",
            toolInput: { query: "needle" }
          }),
          createToolCallBlock({
            toolCallId: "call-2",
            toolInput: { query: "needle" }
          })
        ]
      })
    );

    expect(warningResult.state).toBe("success");
    expect(warningResult.result.data).toMatchObject({
      warnings: [expect.stringContaining("Repeated searches")]
    });

    const blockedResult = await createSearchTextTool(workspace).execute(
      {
        query: "needle"
      },
      createContext(workspace, {
        sessionMessages: [
          createToolCallBlock({
            toolCallId: "call-1",
            toolInput: { query: "needle" }
          }),
          createToolCallBlock({
            toolCallId: "call-2",
            toolInput: { query: "needle" }
          }),
          createToolCallBlock({
            toolCallId: "call-3",
            toolInput: { query: "needle" }
          }),
          createToolCallBlock({
            toolCallId: "call-4",
            toolInput: { query: "needle" }
          })
        ]
      })
    );

    expect(blockedResult.state).toBe("failed");
    expect(blockedResult.result.code).toBe("REPEATED_WORKSPACE_ACCESS_BLOCKED");
  });
});
