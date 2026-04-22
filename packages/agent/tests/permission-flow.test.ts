import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createMemorySessionManager } from "../src/session/index.js";
import { handlePendingPermissionReply } from "../src/runtime/permission.js";
import { executeToolAction } from "../src/runtime/tool-execution.js";
import { createWorkspaceToolRegistry } from "../src/tools/registry.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-stage4-"));
}

describe("Stage 4 permission flow", () => {
  test("allows creating a new file without approval", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();

    try {
      const session = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });
      const executed = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry: createWorkspaceToolRegistry({
          workingDirectory: workspaceRoot
        }),
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-create",
        toolName: "write_file",
        toolInput: {
          path: "todo.txt",
          content: "new file"
        },
        eventSink: undefined
      });

      expect(executed.kind).toBe("completed");
      if (executed.kind !== "completed") {
        throw new Error("expected completed result");
      }
      expect(await readFile(path.join(workspaceRoot, "todo.txt"), "utf8")).toBe(
        "new file"
      );
      expect(executed.output.isError).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("pauses for permission before overwriting an existing file and resumes after approval", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );
      const session = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });

      const permissionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-overwrite",
        toolName: "write_file",
        toolInput: {
          path: "existing.txt",
          content: "after"
        },
        eventSink: undefined
      });

      expect(permissionRequest.kind).toBe("permission_request");
      if (permissionRequest.kind !== "permission_request") {
        throw new Error("expected permission_request result");
      }
      expect(permissionRequest.session.context.status).toBe(
        "waiting_for_permission"
      );
      expect(
        permissionRequest.session.context.pendingPermissionRequest?.toolName
      ).toBe("write_file");
      expect(
        await readFile(path.join(workspaceRoot, "existing.txt"), "utf8")
      ).toBe("before");

      const resumed = await handlePendingPermissionReply({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: permissionRequest.session,
        message: "确认",
        pendingPermissionRequest:
          permissionRequest.session.context.pendingPermissionRequest!,
        eventSink: undefined
      });

      expect(resumed?.kind).toBe("approved");
      if (resumed?.kind !== "approved") {
        throw new Error("expected approved reply result");
      }
      expect(
        await readFile(path.join(workspaceRoot, "existing.txt"), "utf8")
      ).toBe("after");
      expect(resumed.toolOutputs[0]?.isError).toBe(false);

      const reloaded = await sessionManager.getSession(
        permissionRequest.session.sessionId
      );
      expect(reloaded?.context.pendingPermissionRequest).toBeNull();
      expect(
        reloaded?.messages.filter((block) => block.kind === "tool call").length
      ).toBe(1);
      expect(
        reloaded?.messages.filter((block) => block.kind === "tool result")
          .length
      ).toBe(1);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("keeps the workspace unchanged when the user rejects a destructive request", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );
      const session = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });

      const permissionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-reject",
        toolName: "delete_path",
        toolInput: {
          path: "existing.txt"
        },
        eventSink: undefined
      });

      expect(permissionRequest.kind).toBe("permission_request");
      if (permissionRequest.kind !== "permission_request") {
        throw new Error("expected permission_request result");
      }

      const rejected = await handlePendingPermissionReply({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: permissionRequest.session,
        message: "取消",
        pendingPermissionRequest:
          permissionRequest.session.context.pendingPermissionRequest!,
        eventSink: undefined
      });

      expect(rejected?.kind).toBe("completed");
      if (rejected?.kind !== "completed") {
        throw new Error("expected completed rejection result");
      }
      expect(
        await readFile(path.join(workspaceRoot, "existing.txt"), "utf8")
      ).toBe("before");
      expect(rejected.result.status).toBe("waiting for input");
      expect(rejected.result.session.context.status).toBe(
        "waiting_for_user_input"
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("blocks sandbox escapes and always asks before shell commands", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });

    try {
      const session = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });

      const blocked = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-block",
        toolName: "read_file",
        toolInput: {
          path: "../outside.txt"
        },
        eventSink: undefined
      });
      expect(blocked.kind).toBe("completed");
      if (blocked.kind !== "completed") {
        throw new Error("expected completed block result");
      }
      expect(blocked.output.isError).toBe(true);
      expect(blocked.output.content).toContain("SANDBOX_BLOCKED");

      const shellRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: blocked.session,
        turnCount: 1,
        toolCallId: "call-shell",
        toolName: "run_shell_command",
        toolInput: {
          command: "pwd"
        },
        eventSink: undefined
      });
      expect(shellRequest.kind).toBe("permission_request");
      if (shellRequest.kind !== "permission_request") {
        throw new Error("expected shell permission request");
      }
      expect(shellRequest.request.family).toBe("workspace-shell");
      expect(shellRequest.request.permissionProfile).toBe("always-ask-user");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("skips destructive file approval when yolo mode is enabled", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );
      const session = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user",
        yoloMode: true
      });

      const executed = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-yolo-overwrite",
        toolName: "write_file",
        toolInput: {
          path: "existing.txt",
          content: "after"
        },
        eventSink: undefined
      });

      expect(executed.kind).toBe("completed");
      if (executed.kind !== "completed") {
        throw new Error("expected completed result");
      }
      expect(executed.session.context.pendingPermissionRequest).toBeNull();
      expect(
        await readFile(path.join(workspaceRoot, "existing.txt"), "utf8")
      ).toBe("after");

      const shellRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: executed.session,
        turnCount: 2,
        toolCallId: "call-yolo-shell",
        toolName: "run_shell_command",
        toolInput: {
          command: "pwd"
        },
        eventSink: undefined
      });
      expect(shellRequest.kind).toBe("permission_request");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("preserves pending conflict confirmation while pausing for permission", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );
      let session = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });
      session = await sessionManager.updateContext(session.sessionId, {
        status: "waiting_for_conflict_confirmation",
        pendingConfirmationPayload: {
          summaryText: "请确认是否覆盖原有日程",
          proposedItems: [
            {
              previewText: "周四 10:00-11:00 写周报"
            }
          ],
          createdAt: new Date().toISOString()
        },
        pendingConflictSummary: "覆盖原有日程"
      });

      const permissionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-preserve-confirmation",
        toolName: "write_file",
        toolInput: {
          path: "existing.txt",
          content: "after"
        },
        eventSink: undefined
      });

      expect(permissionRequest.kind).toBe("permission_request");
      if (permissionRequest.kind !== "permission_request") {
        throw new Error("expected permission_request result");
      }
      expect(permissionRequest.session.context.status).toBe(
        "waiting_for_permission"
      );
      expect(
        permissionRequest.session.context.pendingConfirmationPayload
      ).not.toBeNull();
      expect(permissionRequest.session.context.pendingConflictSummary).toBe(
        "覆盖原有日程"
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
