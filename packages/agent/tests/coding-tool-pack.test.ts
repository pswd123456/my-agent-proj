import { afterEach, describe, expect, test } from "bun:test";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";
import { createApplyPatchTool } from "../src/tools/apply-patch.js";
import { createFindFilesTool } from "../src/tools/find-files.js";
import {
  createGitDiffCachedTool,
  createGitDiffToolUncached
} from "../src/tools/git-diff.js";
import { createGitStatusTool } from "../src/tools/git-status.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import type { ConversationBlock } from "../src/types.js";

const execFile = promisify(execFileCallback);
const cleanupPaths = new Set<string>();

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coding-tool-pack-"));
  cleanupPaths.add(workspace);
  return workspace;
}

function createToolCallBlock(input: {
  toolName: string;
  toolCallId: string;
  toolInput: Record<string, string | number | boolean | null>;
}): ConversationBlock {
  return {
    id: input.toolCallId,
    kind: "tool call",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    input: input.toolInput,
    state: "pending",
    createdAt: new Date().toISOString()
  };
}

function createToolResultBlock(input: {
  toolName: string;
  toolCallId: string;
  output: string;
  isError?: boolean;
}): ConversationBlock {
  return {
    id: `${input.toolCallId}-result`,
    kind: "tool result",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    output: input.output,
    isError: input.isError ?? false,
    state: input.isError ? "failed" : "success",
    createdAt: new Date().toISOString()
  };
}

function createContext(
  workingDirectory: string,
  options: { sessionMessages?: ConversationBlock[] } = {}
): ToolExecutionContext {
  return {
    sessionId: "session-1",
    userId: "user-1",
    workingDirectory,
    routineRepository: undefined as never,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-04-26",
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

async function createReadMessages(input: {
  workspace: string;
  toolCallId: string;
  path: string;
}): Promise<ConversationBlock[]> {
  const toolInput = { path: input.path };
  const readResult = await createReadFileTool(input.workspace).execute(
    toolInput,
    createContext(input.workspace)
  );
  expect(readResult.state).toBe("success");

  return [
    createToolCallBlock({
      toolName: "read_file",
      toolCallId: input.toolCallId,
      toolInput
    }),
    createToolResultBlock({
      toolName: "read_file",
      toolCallId: input.toolCallId,
      output: readResult.content
    })
  ];
}

async function runGit(
  workingDirectory: string,
  ...args: string[]
): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd: workingDirectory,
    encoding: "utf8"
  });

  return stdout;
}

afterEach(async () => {
  await Promise.all(
    [...cleanupPaths].map((targetPath) =>
      rm(targetPath, { recursive: true, force: true })
    )
  );
  cleanupPaths.clear();
});

describe("find_files", () => {
  test("matches files by root path, glob, suffix, and name pattern", async () => {
    const workspace = await createWorkspace();
    await mkdir(path.join(workspace, "src", "nested"), { recursive: true });
    await writeFile(path.join(workspace, "src", "index.ts"), "export {};\n");
    await writeFile(
      path.join(workspace, "src", "nested", "feature.test.ts"),
      "test();\n"
    );
    await writeFile(
      path.join(workspace, "src", "nested", "feature.tsx"),
      "x\n"
    );

    const result = await createFindFilesTool(workspace).execute(
      {
        path: "src",
        glob: "**/*.ts",
        suffix: ".ts",
        namePattern: "feature",
        maxResults: 10
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      root: "src",
      truncated: false,
      matches: [
        {
          path: "src/nested/feature.test.ts",
          name: "feature.test.ts"
        }
      ]
    });
  });
});

describe("apply_patch", () => {
  test("applies a multi-file unified diff patch", async () => {
    const workspace = await createWorkspace();
    await mkdir(path.join(workspace, "nested"), { recursive: true });
    await writeFile(path.join(workspace, "alpha.txt"), "one\ntwo\n");
    await writeFile(
      path.join(workspace, "nested", "beta.txt"),
      "beta\ngamma\n"
    );
    const alphaReadMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });
    const betaReadMessages = await createReadMessages({
      workspace,
      toolCallId: "read-beta",
      path: "nested/beta.txt"
    });

    const patch = [
      "--- a/alpha.txt",
      "+++ b/alpha.txt",
      "@@ -1,2 +1,2 @@",
      " one",
      "-two",
      "+TWO",
      "--- a/nested/beta.txt",
      "+++ b/nested/beta.txt",
      "@@ -1,2 +1,3 @@",
      " beta",
      " gamma",
      "+delta"
    ].join("\n");

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch
      },
      createContext(workspace, {
        sessionMessages: [...alphaReadMessages, ...betaReadMessages]
      })
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      fileCount: 2,
      files: [
        {
          path: "alpha.txt",
          action: "modify",
          hunkCount: 1,
          addedLineCount: 1,
          removedLineCount: 1,
          diff: [
            "--- a/alpha.txt",
            "+++ b/alpha.txt",
            "@@ -1,2 +1,2 @@",
            " one",
            "-two",
            "+TWO"
          ].join("\n")
        },
        {
          path: "nested/beta.txt",
          action: "modify",
          hunkCount: 1,
          addedLineCount: 1,
          removedLineCount: 0,
          diff: [
            "--- a/nested/beta.txt",
            "+++ b/nested/beta.txt",
            "@@ -1,2 +1,3 @@",
            " beta",
            " gamma",
            "+delta"
          ].join("\n")
        }
      ]
    });
    expect(result.details).toEqual({
      kind: "workspace_file_changes",
      files: [
        {
          path: "alpha.txt",
          action: "modify",
          addedLineCount: 1,
          removedLineCount: 1,
          diff: [
            "--- a/alpha.txt",
            "+++ b/alpha.txt",
            "@@ -1,2 +1,2 @@",
            " one",
            "-two",
            "+TWO"
          ].join("\n")
        },
        {
          path: "nested/beta.txt",
          action: "modify",
          addedLineCount: 1,
          removedLineCount: 0,
          diff: [
            "--- a/nested/beta.txt",
            "+++ b/nested/beta.txt",
            "@@ -1,2 +1,3 @@",
            " beta",
            " gamma",
            "+delta"
          ].join("\n")
        }
      ]
    });
    await expect(
      readFile(path.join(workspace, "alpha.txt"), "utf8")
    ).resolves.toBe("one\nTWO\n");
    await expect(
      readFile(path.join(workspace, "nested", "beta.txt"), "utf8")
    ).resolves.toBe("beta\ngamma\ndelta\n");
  });

  test("rejects malformed patch input", async () => {
    const workspace = await createWorkspace();

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: "not a unified diff"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_PATCH");
  });

  test("fails when modifying an existing file without a session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/alpha.txt",
          "+++ b/alpha.txt",
          "@@ -1,2 +1,2 @@",
          " one",
          "-two",
          "+TWO"
        ].join("\n")
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("FILE_WRITE_REQUIRES_READ");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\ntwo\n");
  });

  test("fails when a patched file changed after the previous session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });
    await writeFile(targetPath, "one\nchanged\n");

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/alpha.txt",
          "+++ b/alpha.txt",
          "@@ -1,2 +1,2 @@",
          " one",
          "-two",
          "+TWO"
        ].join("\n")
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("FILE_CHANGED_SINCE_READ");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\nchanged\n");
  });

  test("creates a new file without a session read", async () => {
    const workspace = await createWorkspace();

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- /dev/null",
          "+++ b/created.txt",
          "@@ -0,0 +1,2 @@",
          "+one",
          "+two"
        ].join("\n")
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("PATCH_APPLIED");
    await expect(
      readFile(path.join(workspace, "created.txt"), "utf8")
    ).resolves.toBe("one\ntwo\n");
  });
});

describe("git read-only tools", () => {
  test("reports git status plus staged and unstaged diffs", async () => {
    const workspace = await createWorkspace();
    await runGit(workspace, "init");
    await runGit(workspace, "config", "user.email", "codex@example.com");
    await runGit(workspace, "config", "user.name", "Codex");

    await writeFile(path.join(workspace, "tracked.txt"), "one\n");
    await runGit(workspace, "add", "tracked.txt");
    await runGit(workspace, "commit", "-m", "init");

    await writeFile(
      path.join(workspace, "tracked.txt"),
      "one\nstaged change\n"
    );
    await runGit(workspace, "add", "tracked.txt");
    await writeFile(
      path.join(workspace, "tracked.txt"),
      "one\nstaged change\nunstaged change\n"
    );

    const context = createContext(workspace);
    const statusResult = await createGitStatusTool().execute({}, context);
    const diffResult = await createGitDiffToolUncached().execute({}, context);
    const diffCachedResult = await createGitDiffCachedTool().execute(
      {},
      context
    );

    expect(statusResult.state).toBe("success");
    expect(statusResult.result.data).toMatchObject({
      clean: false,
      entries: [
        {
          path: "tracked.txt",
          indexStatus: "M",
          workTreeStatus: "M"
        }
      ]
    });

    expect(diffResult.state).toBe("success");
    expect(diffResult.result.data).toMatchObject({
      cached: false,
      hasChanges: true
    });
    expect(String(diffResult.result.data?.diff)).toContain("unstaged change");

    expect(diffCachedResult.state).toBe("success");
    expect(diffCachedResult.result.data).toMatchObject({
      cached: true,
      hasChanges: true
    });
    expect(String(diffCachedResult.result.data?.diff)).toContain(
      "staged change"
    );
  });
});
