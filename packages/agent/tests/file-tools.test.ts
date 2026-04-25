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

import { createEditFileTool } from "../src/tools/edit-file.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import { createWriteFileTool } from "../src/tools/write-file.js";
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

  test("preserves complete content when write_file overwrites an existing file", async () => {
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

    expect(result.state).toBe("success");
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "new content\nwith two lines\n"
    );
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
