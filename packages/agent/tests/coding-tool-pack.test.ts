import { afterEach, describe, expect, test } from "bun:test";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";
import { createApplyPatchTool } from "../src/tools/apply-patch.js";
import { createFindFilesTool } from "../src/tools/find-files.js";
import { createGitDiffTool } from "../src/tools/git-diff.js";
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

describe("read_file", () => {
  test("description tells the model to use only startLine/endLine after search_text line hits", () => {
    const tool = createReadFileTool("/tmp/workspace");

    expect(tool.description).toContain(
      "if search_text already returned a match line"
    );
    expect(tool.description).toContain(
      "prefer {startLine,endLine} for that file and do not also pass offset/limit"
    );
    expect(tool.description).toContain(
      "do not copy search_text result fields like offset into read_file"
    );
  });

  test("rejects mixed line window syntaxes with recovery guidance", async () => {
    const workspace = await createWorkspace();

    const result = await createReadFileTool(workspace).execute(
      {
        path: "alpha.txt",
        startLine: 1,
        endLine: 3,
        limit: 10
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
    expect(result.result.validationErrors).toContainEqual({
      field: "lineWindow",
      issue:
        "Choose exactly one read window syntax: either {offset, limit} or {startLine, endLine}. Remove limit/offset when using startLine/endLine; remove startLine/endLine when using offset/limit."
    });
    expect(result.content).toContain('"field": "lineWindow"');
    expect(result.content).toContain("Choose exactly one read window syntax");
  });
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
  test("schema explains exact hunk counts and patch examples", () => {
    const tool = createApplyPatchTool("/tmp/workspace");
    expect(tool.description).toContain("Read before edit");
    expect(tool.description).toContain("smallest exact hunk");
    expect(tool.description).toContain("hunk counts");
    expect(tool.description).toContain("blank lines");
    expect(tool.description).toContain("oldStart is the 1-based line");
    expect(tool.description).toContain(
      "Header counts must include every unchanged context line shown in the hunk body"
    );
    expect(tool.description).toContain("Do not rewrite nearby identifiers");
    expect(tool.description).toContain(
      "do not change conditions, branches, wrappers"
    );
    expect(tool.description).toContain("Do not invert control flow");
    expect(tool.description).toContain(
      "the deleted content line must appear with a - prefix"
    );
    expect(tool.description).toContain(
      "do not normalize or simplify surrounding code, markup, configuration, or prose structure"
    );

    const patchSchema = tool.inputSchema.properties?.patch;
    if (
      !patchSchema ||
      typeof patchSchema !== "object" ||
      !("description" in patchSchema) ||
      typeof patchSchema.description !== "string"
    ) {
      throw new Error("Expected patch schema description");
    }

    expect(patchSchema.description).toContain(
      "@@ -oldStart,oldCount +newStart,newCount @@"
    );
    expect(patchSchema.description).toContain(
      "oldStart is the 1-based line number"
    );
    expect(patchSchema.description).toContain(
      "oldCount = context + deleted lines"
    );
    expect(patchSchema.description).toContain(
      "If the hunk body contains 4 context lines plus 1 deleted line and 1 added line, the header counts are old=5 and new=5."
    );
    expect(patchSchema.description).toContain(
      "delete only the target content and keep adjacent identifiers"
    );
    expect(patchSchema.description).toContain(
      "keep the surrounding container, branch, key, delimiter, and wrapper lines exactly as they are"
    );
    expect(patchSchema.description).toContain(
      "Do not invert control flow, collapse wrappers, rename keys"
    );
    expect(patchSchema.description).toContain(
      "Keep unchanged surrounding lines as space-prefixed context lines"
    );
    expect(patchSchema.description).toContain(
      "Concrete local content removal example"
    );
    expect(patchSchema.description).toContain("Example modify");
    expect(patchSchema.description).toContain("Example remove one line");
    expect(patchSchema.description).toContain(
      "Example delete with leading blank context"
    );
    expect(patchSchema.description).toContain("Example create");
    expect(patchSchema.description).toContain("single leading space");
  });

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

  test("explains mismatched hunk counts with header and body counts", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "alpha.txt"), "one\ntwo\nthree\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/alpha.txt",
          "+++ b/alpha.txt",
          "@@ -1,2 +1,1 @@",
          " one",
          "-two",
          " three"
        ].join("\n")
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("PATCH_APPLY_FAILED");
    expect(result.content).toContain(
      "Header says old=2, new=1; hunk body consumes old=3, produces new=2."
    );
    expect(result.content).toContain(
      "Fix the @@ header counts or remove extra hunk body lines."
    );
    expect(result.content).toContain(
      "Keep unchanged surrounding lines as space-prefixed context lines"
    );
    expect(result.content).toContain(
      "Do not switch to write_file for this localized edit."
    );
  });

  test("explains context mismatch with oldStart guidance", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "alpha.md"),
      "\nline A\nline B\nold line\n\nheading\n"
    );
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.md"
    });

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/alpha.md",
          "+++ b/alpha.md",
          "@@ -2,6 +2,5 @@",
          " ",
          " line A",
          " line B",
          "-old line",
          " ",
          " heading"
        ].join("\n")
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("PATCH_APPLY_FAILED");
    expect(result.content).toContain(
      "oldStart must point at the first hunk body line"
    );
    expect(result.content).toContain("including unchanged blank lines");
    expect(result.content).toContain(
      "Keep unchanged surrounding lines as space-prefixed context lines"
    );
    expect(result.content).toContain(
      "Do not switch to write_file for this localized edit."
    );
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

  test("allows consecutive patches after the current session patches the file", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });
    const firstInput = {
      patch: [
        "--- a/alpha.txt",
        "+++ b/alpha.txt",
        "@@ -1,2 +1,2 @@",
        " one",
        "-two",
        "+TWO"
      ].join("\n")
    };
    const firstResult = await createApplyPatchTool(workspace).execute(
      firstInput,
      createContext(workspace, { sessionMessages })
    );
    expect(firstResult.state).toBe("success");

    const secondResult = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/alpha.txt",
          "+++ b/alpha.txt",
          "@@ -1,2 +1,2 @@",
          " one",
          "-TWO",
          "+THREE"
        ].join("\n")
      },
      createContext(workspace, {
        sessionMessages: [
          ...sessionMessages,
          createToolCallBlock({
            toolName: "apply_patch",
            toolCallId: "first-patch",
            toolInput: firstInput
          }),
          createToolResultBlock({
            toolName: "apply_patch",
            toolCallId: "first-patch",
            output: firstResult.content
          })
        ]
      })
    );

    expect(secondResult.state).toBe("success");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\nTHREE\n");
  });

  test("requires a new read when another writer changes a file after this session patches it", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });
    const firstInput = {
      patch: [
        "--- a/alpha.txt",
        "+++ b/alpha.txt",
        "@@ -1,2 +1,2 @@",
        " one",
        "-two",
        "+TWO"
      ].join("\n")
    };
    const firstResult = await createApplyPatchTool(workspace).execute(
      firstInput,
      createContext(workspace, { sessionMessages })
    );
    expect(firstResult.state).toBe("success");
    await writeFile(targetPath, "one\nexternal change\n");

    const staleResult = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/alpha.txt",
          "+++ b/alpha.txt",
          "@@ -1,2 +1,2 @@",
          " one",
          "-TWO",
          "+THREE"
        ].join("\n")
      },
      createContext(workspace, {
        sessionMessages: [
          ...sessionMessages,
          createToolCallBlock({
            toolName: "apply_patch",
            toolCallId: "first-patch",
            toolInput: firstInput
          }),
          createToolResultBlock({
            toolName: "apply_patch",
            toolCallId: "first-patch",
            output: firstResult.content
          })
        ]
      })
    );

    expect(staleResult.state).toBe("failed");
    expect(staleResult.result.code).toBe("FILE_CHANGED_SINCE_READ");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "one\nexternal change\n"
    );
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

  test("canonicalizes a malformed localized text deletion patch", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "component.tsx");
    await writeFile(
      targetPath,
      [
        "export function Demo() {",
        "  return (",
        "    <div>",
        "      {true ? null : (",
        "        <div",
        "          className={getSoftBlockClass(",
        '            "py-6 text-sm text-[var(--app-text-muted)]"',
        "          )}",
        "        >",
        "          发送请求后，这里会显示当前会话的对话和执行记录。",
        "        </div>",
        "      )}",
        "    </div>",
        "  );",
        "}"
      ].join("\n")
    );
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-component",
      path: "component.tsx"
    });

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/component.tsx",
          "+++ b/component.tsx",
          "@@ -7,7 +7,6 @@",
          "          className={getSoftBlockClass(",
          '            "py-6 text-sm text-[var(--app-text-muted)]"',
          "          )}",
          "-        >",
          "-          发送请求后，这里会显示当前会话的对话和执行记录。",
          "-        </div>",
          "+        />"
        ].join("\n")
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("success");
    expect(result.details).toEqual({
      kind: "workspace_file_changes",
      files: [
        {
          path: "component.tsx",
          action: "modify",
          addedLineCount: 0,
          removedLineCount: 1,
          diff: [
            "--- a/component.tsx",
            "+++ b/component.tsx",
            "@@ -9,3 +9,2 @@",
            "         >",
            "-          发送请求后，这里会显示当前会话的对话和执行记录。",
            "         </div>"
          ].join("\n")
        }
      ]
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      [
        "export function Demo() {",
        "  return (",
        "    <div>",
        "      {true ? null : (",
        "        <div",
        "          className={getSoftBlockClass(",
        '            "py-6 text-sm text-[var(--app-text-muted)]"',
        "          )}",
        "        >",
        "        </div>",
        "      )}",
        "    </div>",
        "  );",
        "}"
      ].join("\n")
    );
  });

  test("rejects a tsx patch that would remove structural closing lines", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "component.tsx");
    await writeFile(
      targetPath,
      [
        "export function Demo() {",
        "  return (",
        "    <div>",
        "      {true ? null : (",
        "        <div>",
        "          hello",
        "        </div>",
        "      )}",
        "    </div>",
        "  );",
        "}"
      ].join("\n")
    );
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-component",
      path: "component.tsx"
    });

    const result = await createApplyPatchTool(workspace).execute(
      {
        patch: [
          "--- a/component.tsx",
          "+++ b/component.tsx",
          "@@ -5,3 +5,2 @@",
          "         <div>",
          "           hello",
          "-        </div>"
        ].join("\n")
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("PATCH_APPLY_FAILED");
    expect(result.content).toContain(
      "Patch would leave component.tsx syntactically invalid."
    );
    expect(result.content).toContain(
      "Keep unchanged structural lines, braces, parentheses"
    );
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      [
        "export function Demo() {",
        "  return (",
        "    <div>",
        "      {true ? null : (",
        "        <div>",
        "          hello",
        "        </div>",
        "      )}",
        "    </div>",
        "  );",
        "}"
      ].join("\n")
    );
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
    const diffResult = await createGitDiffTool().execute({}, context);
    const diffCachedResult = await createGitDiffTool().execute(
      { cached: true },
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
