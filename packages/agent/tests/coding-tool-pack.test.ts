import { afterEach, describe, expect, test } from "bun:test";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";
import { createEditFileTool } from "../src/tools/edit-file.js";
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

describe("edit_file", () => {
  test("schema explains string replacement, read-before-edit, uniqueness, and replaceAll", () => {
    const tool = createEditFileTool("/tmp/workspace");
    expect(tool.description).toContain("Read before edit");
    expect(tool.description).toContain("oldString");
    expect(tool.description).toContain("newString");
    expect(tool.description).toContain("replaceAll");
    expect(tool.description).toContain(
      "oldString must identify one occurrence"
    );
    expect(tool.description).toContain(
      "do not write unified diff syntax; edit_file generates the diff itself"
    );
    expect(tool.description).not.toContain("@@ -oldStart");

    const oldStringSchema = tool.inputSchema.properties?.oldString;
    if (
      !oldStringSchema ||
      typeof oldStringSchema !== "object" ||
      !("description" in oldStringSchema) ||
      typeof oldStringSchema.description !== "string"
    ) {
      throw new Error("Expected oldString schema description");
    }

    expect(oldStringSchema.description).toContain("Exact current text");
    expect(oldStringSchema.description).toContain(
      "unique unless replaceAll is true"
    );
  });

  test("applies a localized edit and returns workspace file changes", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });

    const result = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "two",
        newString: "TWO"
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      path: "alpha.txt",
      replacementCount: 1,
      replaceAll: false
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
        }
      ]
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\nTWO\n");
  });

  test("deletes local content by using an empty newString", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\nthree\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });

    const result = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "two",
        newString: ""
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("success");
    expect(result.details).toEqual({
      kind: "workspace_file_changes",
      files: [
        {
          path: "alpha.txt",
          action: "modify",
          addedLineCount: 0,
          removedLineCount: 1,
          diff: [
            "--- a/alpha.txt",
            "+++ b/alpha.txt",
            "@@ -1,3 +1,2 @@",
            " one",
            "-two",
            " three"
          ].join("\n")
        }
      ]
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\nthree\n");
  });

  test("rejects malformed edit input", async () => {
    const workspace = await createWorkspace();

    const result = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        patch: "not accepted"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
    expect(result.content).toContain("oldString must be a non-empty string");
    expect(result.content).toContain("Do not pass patch");
  });

  test("fails when editing an existing file without a session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");

    const result = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "two",
        newString: "TWO"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("FILE_WRITE_REQUIRES_READ");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\ntwo\n");
  });

  test("fails when the file changed after the previous session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });
    await writeFile(targetPath, "one\nchanged\n");

    const result = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "two",
        newString: "TWO"
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("FILE_CHANGED_SINCE_READ");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\nchanged\n");
  });

  test("allows consecutive edits after this session edits the file", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });
    const firstInput = {
      path: "alpha.txt",
      oldString: "two",
      newString: "TWO"
    };
    const firstResult = await createEditFileTool(workspace).execute(
      firstInput,
      createContext(workspace, { sessionMessages })
    );
    expect(firstResult.state).toBe("success");

    const secondResult = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "TWO",
        newString: "THREE"
      },
      createContext(workspace, {
        sessionMessages: [
          ...sessionMessages,
          createToolCallBlock({
            toolName: "edit_file",
            toolCallId: "first-edit",
            toolInput: firstInput
          }),
          createToolResultBlock({
            toolName: "edit_file",
            toolCallId: "first-edit",
            output: firstResult.content
          })
        ]
      })
    );

    expect(secondResult.state).toBe("success");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("one\nTHREE\n");
  });

  test("requires a new read when another writer changes a file after this session edits it", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "one\ntwo\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });
    const firstInput = {
      path: "alpha.txt",
      oldString: "two",
      newString: "TWO"
    };
    const firstResult = await createEditFileTool(workspace).execute(
      firstInput,
      createContext(workspace, { sessionMessages })
    );
    expect(firstResult.state).toBe("success");
    await writeFile(targetPath, "one\nexternal change\n");

    const staleResult = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "TWO",
        newString: "THREE"
      },
      createContext(workspace, {
        sessionMessages: [
          ...sessionMessages,
          createToolCallBlock({
            toolName: "edit_file",
            toolCallId: "first-edit",
            toolInput: firstInput
          }),
          createToolResultBlock({
            toolName: "edit_file",
            toolCallId: "first-edit",
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

  test("rejects ambiguous oldString unless replaceAll is true", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "same\nother\nsame\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });

    const result = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "same",
        newString: "changed"
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("STRING_NOT_UNIQUE");
    expect(result.result.data).toMatchObject({ matchCount: 2 });
    expect(result.displayText).toContain("oldString matched 2 locations");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "same\nother\nsame\n"
    );
  });

  test("replaceAll replaces every exact match", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "alpha.txt");
    await writeFile(targetPath, "same\nother\nsame\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-alpha",
      path: "alpha.txt"
    });

    const result = await createEditFileTool(workspace).execute(
      {
        path: "alpha.txt",
        oldString: "same",
        newString: "changed",
        replaceAll: true
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      replacementCount: 2,
      replaceAll: true
    });
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "changed\nother\nchanged\n"
    );
  });

  test("removes trace-style adjacent block without touching later similar fields", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "settings.tsx");
    await writeFile(
      targetPath,
      [
        "export function ActiveChats({ binding }: { binding: { externalChatId: string } }) {",
        "  return (",
        '    <section aria-label="Active Telegram Chats">',
        '      <div className="chat-row">',
        '        <div className="font-mono text-xs text-[var(--app-text-primary)]">',
        "          {binding.externalChatId}",
        "        </div>",
        '        <div className="text-xs">Telegram User ID</div>',
        '        <div className="font-mono text-xs">',
        "          {binding.externalChatId}",
        "        </div>",
        "      </div>",
        "    </section>",
        "  );",
        "}"
      ].join("\n")
    );
    const sessionMessages = await createReadMessages({
      workspace,
      toolCallId: "read-settings",
      path: "settings.tsx"
    });

    const result = await createEditFileTool(workspace).execute(
      {
        path: "settings.tsx",
        oldString: [
          '        <div className="font-mono text-xs text-[var(--app-text-primary)]">',
          "          {binding.externalChatId}",
          "        </div>",
          ""
        ].join("\n"),
        newString: ""
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("success");
    const nextContent = await readFile(targetPath, "utf8");
    expect(nextContent).not.toContain("text-[var(--app-text-primary)]");
    expect(nextContent).toContain("Telegram User ID");
    expect(nextContent).toContain(
      [
        '        <div className="font-mono text-xs">',
        "          {binding.externalChatId}",
        "        </div>"
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
