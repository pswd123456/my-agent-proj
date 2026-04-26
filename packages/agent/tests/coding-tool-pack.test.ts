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

const execFile = promisify(execFileCallback);
const cleanupPaths = new Set<string>();

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coding-tool-pack-"));
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
    sessionMessages: []
  };
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
    await writeFile(path.join(workspace, "src", "nested", "feature.tsx"), "x\n");

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
    await writeFile(path.join(workspace, "nested", "beta.txt"), "beta\ngamma\n");

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
      createContext(workspace)
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
    await expect(readFile(path.join(workspace, "alpha.txt"), "utf8")).resolves.toBe(
      "one\nTWO\n"
    );
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

    await writeFile(path.join(workspace, "tracked.txt"), "one\nstaged change\n");
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
