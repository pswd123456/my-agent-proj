import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createReadFileTool } from "../src/tools/read-file.js";
import { createWriteFileTool } from "../src/tools/write-file.js";
import { estimateTextTokens } from "../src/runtime/token-budget.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";
import { preflightWorkspaceSandboxTargets } from "../src/tools/workspace.js";
import type { ConversationBlock } from "../src/types.js";

const cleanupPaths = new Set<string>();

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "file-tools-"));
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
  options: {
    allowWorkspaceEscape?: boolean;
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
    sessionMessages: options.sessionMessages ?? [],
    ...(typeof options.allowWorkspaceEscape === "boolean"
      ? { allowWorkspaceEscape: options.allowWorkspaceEscape }
      : {})
  };
}

async function createReadMessages(input: {
  workspace: string;
  toolCallId?: string;
  toolInput: Record<string, string | number | boolean | null>;
}): Promise<ConversationBlock[]> {
  const toolCallId = input.toolCallId ?? "read-before-write";
  const readResult = await createReadFileTool(input.workspace).execute(
    input.toolInput,
    createContext(input.workspace)
  );
  expect(readResult.state).toBe("success");

  return [
    createToolCallBlock({
      toolName: "read_file",
      toolCallId,
      toolInput: input.toolInput
    }),
    createToolResultBlock({
      toolName: "read_file",
      toolCallId,
      output: readResult.content
    })
  ];
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
      offset: 1,
      limit: 2,
      truncated: false,
      startLine: 2,
      endLine: 3,
      content: "two\nthree"
    });
  });

  test("supports offset and limit line paging", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "notes.txt"),
      "one\ntwo\nthree\nfour\nfive\n"
    );

    const result = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        offset: 2,
        limit: 2
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.data).toMatchObject({
      path: "notes.txt",
      offset: 2,
      limit: 2,
      truncated: false,
      startLine: 3,
      endLine: 4,
      content: "three\nfour"
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

  test("rejects mixed legacy and offset-limit range inputs", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "one\ntwo\n");

    const result = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        startLine: 1,
        offset: 0,
        limit: 1
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
  });

  test("blocks binary files", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "image.bin"),
      Buffer.from([0, 159, 12, 0])
    );

    const result = await createReadFileTool(workspace).execute(
      {
        path: "image.bin"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("BINARY_FILE_NOT_SUPPORTED");
  });

  test("blocks device targets even when workspace escape is allowed", async () => {
    const workspace = await createWorkspace();

    const result = await createReadFileTool(workspace).execute(
      {
        path: "/dev/null"
      },
      createContext(workspace, {
        allowWorkspaceEscape: true
      })
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("TARGET_NOT_REGULAR_FILE");
  });

  test("stops when requested output exceeds the safe limit", async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace, "huge.txt"),
      `${"x".repeat(200_001)}\n`
    );

    const result = await createReadFileTool(workspace).execute(
      {
        path: "huge.txt"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("READ_OUTPUT_LIMIT_EXCEEDED");
    expect(result.result.message).toContain(
      "Use search_text to locate the relevant content first"
    );
    expect(result.displayText).toContain(
      "use search_text first, then retry with offset and limit"
    );
  });

  test("stops when a single read would exceed the safe token limit", async () => {
    const workspace = await createWorkspace();
    const content = "a\n".repeat(30_000);
    expect(estimateTextTokens(content)).toBeGreaterThan(25_000);

    await writeFile(path.join(workspace, "token-heavy.txt"), content);

    const result = await createReadFileTool(workspace).execute(
      {
        path: "token-heavy.txt"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("READ_OUTPUT_TOKEN_LIMIT_EXCEEDED");
    expect(result.result.data).toMatchObject({
      maxOutputTokens: 25_000
    });
    expect(result.result.message).toContain(
      "Use search_text to locate the relevant content first"
    );
    expect(result.displayText).toContain(
      "use search_text first, then retry with offset and limit"
    );
  });

  test("requires a finite window for oversized files and allows paged reads", async () => {
    const workspace = await createWorkspace();
    const lines = Array.from(
      { length: 32_000 },
      (_, index) => `${String(index + 1).padStart(5, "0")}:${"x".repeat(70)}`
    );
    await writeFile(path.join(workspace, "huge.txt"), `${lines.join("\n")}\n`);

    const fullResult = await createReadFileTool(workspace).execute(
      {
        path: "huge.txt"
      },
      createContext(workspace)
    );

    expect(fullResult.state).toBe("failed");
    expect(fullResult.result.code).toBe("READ_FILE_TOO_LARGE");
    expect(fullResult.result.message).toContain(
      "Use search_text to locate the relevant content first"
    );
    expect(fullResult.displayText).toContain(
      "use search_text first, then retry with offset and limit"
    );

    const pagedResult = await createReadFileTool(workspace).execute(
      {
        path: "huge.txt",
        offset: 10,
        limit: 3
      },
      createContext(workspace)
    );

    expect(pagedResult.state).toBe("success");
    expect(pagedResult.result.data).toMatchObject({
      path: "huge.txt",
      offset: 10,
      limit: 3,
      startLine: 11,
      endLine: 13,
      content: [lines[10], lines[11], lines[12]].join("\n")
    });
  });

  test("emits a warning for repeated reads and blocks tight read loops", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "one\ntwo\n");

    const warningResult = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt"
      },
      createContext(workspace, {
        sessionMessages: [
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-1",
            toolInput: { path: "notes.txt" }
          }),
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-2",
            toolInput: { path: "notes.txt" }
          })
        ]
      })
    );

    expect(warningResult.state).toBe("success");
    expect(warningResult.result.data).toMatchObject({
      warnings: [expect.stringContaining("Repeated reads")]
    });

    const blockedResult = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt"
      },
      createContext(workspace, {
        sessionMessages: [
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-1",
            toolInput: { path: "notes.txt" }
          }),
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-2",
            toolInput: { path: "notes.txt" }
          }),
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-3",
            toolInput: { path: "notes.txt" }
          }),
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-4",
            toolInput: { path: "notes.txt" }
          })
        ]
      })
    );

    expect(blockedResult.state).toBe("failed");
    expect(blockedResult.result.code).toBe("REPEATED_WORKSPACE_ACCESS_BLOCKED");
  });

  test("returns an unchanged stub when the same range was already read", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "one\ntwo\nthree\n");

    const previousResult = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        offset: 1,
        limit: 2
      },
      createContext(workspace)
    );

    expect(previousResult.state).toBe("success");

    const result = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        offset: 1,
        limit: 2
      },
      createContext(workspace, {
        sessionMessages: [
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-1",
            toolInput: { path: "notes.txt", offset: 1, limit: 2 }
          }),
          createToolResultBlock({
            toolName: "read_file",
            toolCallId: "call-1",
            output: previousResult.content
          })
        ]
      })
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("FILE_READ_UNCHANGED_STUB");
    expect(result.result.data).toMatchObject({
      path: "notes.txt",
      offset: 1,
      limit: 2,
      deduplicated: true,
      content: expect.stringContaining("File unchanged since last read")
    });
  });

  test("re-reads content when the file changed after the previous read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "notes.txt");
    await writeFile(targetPath, "one\ntwo\nthree\n");

    const previousResult = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        offset: 0,
        limit: 2
      },
      createContext(workspace)
    );

    expect(previousResult.state).toBe("success");

    await writeFile(targetPath, "one\nTWO\nthree\n");

    const result = await createReadFileTool(workspace).execute(
      {
        path: "notes.txt",
        offset: 0,
        limit: 2
      },
      createContext(workspace, {
        sessionMessages: [
          createToolCallBlock({
            toolName: "read_file",
            toolCallId: "call-1",
            toolInput: { path: "notes.txt", offset: 0, limit: 2 }
          }),
          createToolResultBlock({
            toolName: "read_file",
            toolCallId: "call-1",
            output: previousResult.content
          })
        ]
      })
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("FILE_READ_OK");
    expect(result.result.data).toMatchObject({
      deduplicated: false,
      content: "one\nTWO"
    });
  });
});

describe("write_file", () => {
  test("rejects line edit fields", async () => {
    const workspace = await createWorkspace();

    const result = await createWriteFileTool(workspace).execute(
      {
        path: "notes.txt",
        mode: "edit_lines",
        startLine: 1,
        endLine: 1,
        content: "replacement"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
    expect(result.content).toContain("Use apply_patch for line edits.");
  });

  test("declares a destructive permission request for existing files", async () => {
    const workspace = await createWorkspace();
    await writeFile(path.join(workspace, "notes.txt"), "one\n");

    const request = await createWriteFileTool(workspace).getPermissionRequest?.(
      {
        path: "notes.txt",
        content: "two\n"
      },
      createContext(workspace)
    );

    expect(request?.summaryText).toContain("notes.txt");
  });

  test("fails when overwriting an existing file without a session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "notes.txt");
    await writeFile(targetPath, "old content\n");

    const result = await createWriteFileTool(workspace).execute(
      {
        path: "notes.txt",
        content: "new content\nwith two lines\n"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("FILE_WRITE_REQUIRES_READ");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("old content\n");
  });

  test("preserves complete content when overwriting an existing file after a session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "notes.txt");
    await writeFile(targetPath, "old content\n");
    const sessionMessages = await createReadMessages({
      workspace,
      toolInput: { path: "notes.txt" }
    });

    const result = await createWriteFileTool(workspace).execute(
      {
        path: "notes.txt",
        content: "new content\nwith two lines\n"
      },
      createContext(workspace, { sessionMessages })
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("FILE_UPDATED");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "new content\nwith two lines\n"
    );
  });

  test("fails when a file changed after the previous session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "notes.txt");
    await writeFile(targetPath, "old content\n");
    const staleMessages = await createReadMessages({
      workspace,
      toolInput: { path: "notes.txt" }
    });
    await writeFile(targetPath, "external change\n");

    const staleResult = await createWriteFileTool(workspace).execute(
      {
        path: "notes.txt",
        content: "new content\n"
      },
      createContext(workspace, { sessionMessages: staleMessages })
    );

    expect(staleResult.state).toBe("failed");
    expect(staleResult.result.code).toBe("FILE_CHANGED_SINCE_READ");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "external change\n"
    );

    const freshMessages = await createReadMessages({
      workspace,
      toolCallId: "fresh-read",
      toolInput: { path: "notes.txt" }
    });
    const freshResult = await createWriteFileTool(workspace).execute(
      {
        path: "notes.txt",
        content: "new content\n"
      },
      createContext(workspace, {
        sessionMessages: [...staleMessages, ...freshMessages]
      })
    );

    expect(freshResult.state).toBe("success");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("new content\n");
  });

  test("fails write_file when the parent directory is missing", async () => {
    const workspace = await createWorkspace();

    const result = await createWriteFileTool(workspace).execute(
      {
        path: "missing/notes.txt",
        content: "hello"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("WRITE_FILE_PARENT_MISSING");
  });

  test("creates a new file without a prior session read", async () => {
    const workspace = await createWorkspace();
    const targetPath = path.join(workspace, "notes.txt");

    const result = await createWriteFileTool(workspace).execute(
      {
        path: "notes.txt",
        content: "hello\n"
      },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("FILE_CREATED");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("hello\n");
  });
});

describe("workspace sandbox preflight", () => {
  test("classifies explicit parent and absolute paths as outside_workspace", async () => {
    const workspace = await createWorkspace();
    const outsideFile = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
    cleanupPaths.add(outsideFile);
    await writeFile(outsideFile, "outside");

    const result = await preflightWorkspaceSandboxTargets({
      workingDirectory: workspace,
      targets: ["../outside.txt", outsideFile]
    });

    expect(result.outsideTargets).toHaveLength(2);
    expect(
      result.outsideTargets.map((target) => target.classification)
    ).toEqual(["outside_workspace", "outside_workspace"]);
  });

  test("blocks symlink escapes that resolve outside the workspace", async () => {
    const workspace = await createWorkspace();
    const externalDirectory = await createWorkspace();
    await writeFile(path.join(externalDirectory, "secret.txt"), "secret");
    await symlink(externalDirectory, path.join(workspace, "linked-outside"));

    const result = await preflightWorkspaceSandboxTargets({
      workingDirectory: workspace,
      targets: ["linked-outside/secret.txt"]
    });

    expect(result.symlinkEscapeTargets).toHaveLength(1);
    expect(result.symlinkEscapeTargets[0]?.classification).toBe(
      "symlink_escape"
    );
  });

  test("checks the nearest existing parent realpath for missing targets", async () => {
    const workspace = await createWorkspace();
    const externalDirectory = await createWorkspace();
    const linkedDirectory = path.join(workspace, "linked-parent");
    await symlink(externalDirectory, linkedDirectory);
    await mkdir(path.join(externalDirectory, "nested"), { recursive: true });

    const result = await preflightWorkspaceSandboxTargets({
      workingDirectory: workspace,
      targets: ["linked-parent/nested/missing.txt"]
    });

    expect(result.symlinkEscapeTargets).toHaveLength(1);
    expect(result.symlinkEscapeTargets[0]?.existingPath).toBe(
      path.join(workspace, "linked-parent", "nested")
    );
  });
});
