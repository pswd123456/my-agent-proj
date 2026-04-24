import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEditFileTool } from "../src/tools/edit-file.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

const cleanupPaths = new Set<string>();

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "file-tools-"));
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

describe("read_file", () => {
  test("reads full content by default without truncating", async () => {
    const workspace = await createWorkspace();
    const content = `${"x".repeat(13_000)}\nend`;
    await writeFile(path.join(workspace, "large.txt"), content);

    const result = await createReadFileTool(workspace).execute(
      {
        path: "large.txt"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      path: "large.txt",
      truncated: false,
      content
    });
  });

  test("reads an inclusive line range", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "notes.txt"),
      "one\ntwo\nthree\nfour\n"
    );

    const result = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        startLine: 2,
        endLine: 3
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      path: "notes.txt",
      truncated: false,
      startLine: 2,
      endLine: 3,
      content: "two\nthree"
    });
  });

  test("rejects an invalid line range", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "one\ntwo\n");

    const result = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        startLine: 3,
        endLine: 2
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
  });
});

describe("edit_file", () => {
  test("replaces an inclusive line range", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "notes.txt");
    await writeFile(targetPath, "one\ntwo\nthree\nfour\n");

    const result = await createEditFileTool(workspace).execute(
      {
        path: "notes.txt",
        startLine: 2,
        endLine: 3,
        content: "TWO\nTHREE"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      path: "notes.txt",
      startLine: 2,
      endLine: 3,
      replacedLineCount: 2,
      newLineCount: 2,
      diff: [
        "--- notes.txt",
        "+++ notes.txt",
        "@@ -2,2 +2,2 @@",
        "- two",
        "- three",
        "+ TWO",
        "+ THREE"
      ].join("\n")
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "one\nTWO\nTHREE\nfour\n"
    );
  });

  test("rejects ranges outside the file", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "one\ntwo\n");

    const result = await createEditFileTool(workspace).execute(
      {
        path: "notes.txt",
        startLine: 2,
        endLine: 3,
        content: "replacement"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("LINE_RANGE_OUT_OF_BOUNDS");
  });

  test("declares a destructive permission request for existing files", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "one\n");

    const request = await createEditFileTool(workspace).getPermissionRequest?.(
      {
        path: "notes.txt",
        startLine: 1,
        endLine: 1,
        content: "two"
      },
      createContext(workspace)
    );

    expect(request?.summaryText).toContain("notes.txt");
  });
});
