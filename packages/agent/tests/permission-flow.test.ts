import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime } from "../src/runtime.js";
import type { RunStreamEvent } from "../src/events.js";
import {
  createPostgresTestSessionManager,
  type PostgresTestSessionManager
} from "../../../tests/helpers/postgres-session-manager.js";
import { matchesPermissionRuleLists } from "../src/runtime/permission-rules.js";
import { handlePendingPermissionReply } from "../src/runtime/permission.js";
import { executeToolAction } from "../src/runtime/tool-execution.js";
import {
  createPlanningToolRegistry,
  createWorkspaceToolRegistry
} from "../src/tools/registry.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-stage4-"));
}

async function readFileIntoSession(input: {
  sessionManager: PostgresTestSessionManager;
  routineRepository: ReturnType<typeof createMemoryRoutineRepository>;
  toolRegistry: ReturnType<typeof createWorkspaceToolRegistry>;
  session: Awaited<ReturnType<PostgresTestSessionManager["createSession"]>>;
  path: string;
}) {
  const result = await executeToolAction({
    sessionManager: input.sessionManager,
    routineRepository: input.routineRepository,
    toolRegistry: input.toolRegistry,
    traceManager: undefined,
    session: input.session,
    turnCount: 0,
    toolCallId: `read-${input.path}`,
    toolName: "read_file",
    toolInput: { path: input.path },
    eventSink: undefined
  });

  expect(result.kind).toBe("completed");
  if (result.kind !== "completed") {
    throw new Error("expected read_file to complete");
  }
  expect(result.output.isError).toBe(false);

  return result.session;
}

describe("Stage 4 permission flow", () => {
  test("pauses for permission without writing an assistant guidance block", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const emittedEvents: RunStreamEvent[] = [];

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );

      const runtime = createAgentRuntime({
        client: {
          messages: {
            async create() {
              return {
                content: [
                  {
                    type: "tool_use" as const,
                    id: "call-overwrite",
                    name: "write_file",
                    input: {
                      path: "existing.txt",
                      content: "after"
                    }
                  }
                ],
                stop_reason: "tool_use" as const
              };
            }
          }
        },
        model: "MiniMax-M2.7",
        sessionManager,
        routineRepository,
        toolRegistry: createWorkspaceToolRegistry({
          workingDirectory: workspaceRoot
        }),
        maxTurns: 2
      });

      const session = await runtime.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });

      const result = await runtime.run({
        sessionId: session.sessionId,
        message: "覆盖这个文件",
        eventSink(event) {
          emittedEvents.push(event);
        }
      });

      expect(result.status).toBe("waiting for input");
      expect(result.finalAnswer).toBe("");
      expect(result.session.context.status).toBe("waiting_for_permission");
      expect(result.session.context.pendingPermissionRequest?.toolName).toBe(
        "write_file"
      );
      expect(
        result.session.messages.some((block) => block.kind === "assistant")
      ).toBe(false);
      expect(
        emittedEvents.some((event) => event.kind === "assistant_text")
      ).toBe(false);
      expect(
        emittedEvents.some((event) => event.kind === "permission_request")
      ).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("matches shell allow patterns with multi-argument commands", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: ["git *"],
        shellDenyPatterns: [],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      },
      "run_shell_command",
      "git status --short"
    );

    expect(result.allow).toBe(true);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(false);
  });

  test("matches shell allow patterns across escaped newlines in one command", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: ["git add *"],
        shellDenyPatterns: [],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      },
      "run_shell_command",
      "git add apps/web/app.tsx \\\n  apps/web/app.test.tsx"
    );

    expect(result.allow).toBe(true);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(false);
  });

  test("does not let a single-command allow pattern bypass chained shell operators", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: ["cd *"],
        shellDenyPatterns: [],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      },
      "run_shell_command",
      "cd packages/agent && rm -rf dist"
    );

    expect(result.allow).toBe(false);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(false);
  });

  test("matches structured shell allow patterns when the operator chain also matches", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: ["git add * && git diff --cached *"],
        shellDenyPatterns: [],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      },
      "run_shell_command",
      "git add apps/web/app.tsx \\\n  apps/web/app.test.tsx && git diff --cached -- apps/web/"
    );

    expect(result.allow).toBe(true);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(false);
  });

  test("allows structured shell commands when every segment matches an allow pattern", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: ["cd *", "git add *", "git commit *"],
        shellDenyPatterns: [],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      },
      "run_shell_command",
      'cd /Users/boneda/gitrepo/my-agent-proj && git add packages/agent/tests/permission-flow.test.ts && git commit -m "fix permissions"'
    );

    expect(result.allow).toBe(true);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(false);
  });

  test("asks for structured shell commands when any segment lacks an allow pattern", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: ["cd *", "git add *", "git commit *"],
        shellDenyPatterns: [],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      },
      "run_shell_command",
      'cd /Users/boneda/gitrepo/my-agent-proj && git add packages/agent/tests/permission-flow.test.ts && git commit -m "fix permissions" && git push'
    );

    expect(result.allow).toBe(false);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(false);
  });

  test("denies structured shell commands when any segment matches a deny pattern", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: ["cd *", "git add *", "git commit *"],
        shellDenyPatterns: ["git commit *"],
        toolAllowList: [],
        toolAskList: [],
        toolDenyList: []
      },
      "run_shell_command",
      'cd /Users/boneda/gitrepo/my-agent-proj && git add packages/agent/tests/permission-flow.test.ts && git commit -m "fix permissions"'
    );

    expect(result.allow).toBe(true);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(true);
  });

  test("prefers allow over ask when a tool is present in both lists", () => {
    const result = matchesPermissionRuleLists(
      {
        shellAllowPatterns: [],
        shellDenyPatterns: [],
        toolAllowList: ["read_file"],
        toolAskList: ["read_file"],
        toolDenyList: []
      },
      "read_file"
    );

    expect(result.allow).toBe(true);
    expect(result.ask).toBe(false);
    expect(result.deny).toBe(false);
  });

  test("allows creating a new file without approval", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
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

  test("blocks ordinary workspace file mutations while plan mode is enabled", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();

    try {
      const session = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user",
        planModeEnabled: true
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
        toolCallId: "call-planmode-write",
        toolName: "write_file",
        toolInput: {
          path: "todo.txt",
          content: "blocked"
        },
        eventSink: undefined
      });

      expect(executed.kind).toBe("completed");
      if (executed.kind !== "completed") {
        throw new Error("expected completed result");
      }
      expect(executed.output.isError).toBe(true);
      expect(executed.output.displayText).toContain(
        "Plan mode blocks workspace file mutations"
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("blocks todo tools while plan mode is enabled", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();

    const session = await sessionManager.createSession({
      workingDirectory: await createWorkspaceRoot(),
      model: "MiniMax-M2.7",
      userId: "stage4-user",
      planModeEnabled: true
    });

    const executed = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry: createPlanningToolRegistry(),
      traceManager: undefined,
      session,
      turnCount: 1,
      toolCallId: "call-planmode-todo",
      toolName: "replace_todo_list",
      toolInput: {
        items: [{ content: "Should be blocked in plan mode" }]
      },
      eventSink: undefined
    });

    expect(executed.kind).toBe("completed");
    if (executed.kind !== "completed") {
      throw new Error("expected completed result");
    }
    expect(executed.output.isError).toBe(true);
    expect(executed.output.displayText).toContain(
      "Plan mode disables todo tools"
    );
  });

  test("pauses for a structured user question outside plan mode", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();

    const session = await sessionManager.createSession({
      workingDirectory: await createWorkspaceRoot(),
      model: "MiniMax-M2.7",
      userId: "stage4-user",
      planModeEnabled: false
    });

    const executed = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry: createPlanningToolRegistry(),
      traceManager: undefined,
      session,
      turnCount: 1,
      toolCallId: "call-question-outside-plan",
      toolName: "ask_user_question",
      toolInput: {
        question_text: "要先做 CLI 还是 Web？"
      },
      eventSink: undefined
    });

    expect(executed.kind).toBe("completed");
    if (executed.kind !== "completed") {
      throw new Error("expected completed result");
    }
    expect(executed.output.isError).toBe(false);
    expect(executed.output.displayText).toContain(
      "[ask_user_question] waiting for clarification"
    );

    const updatedSession = await sessionManager.getSession(session.sessionId);
    expect(updatedSession?.context.status).toBe("waiting_for_user_question");
    expect(updatedSession?.context.pendingUserQuestionPayload).toMatchObject({
      questions: [
        {
          questionText: "要先做 CLI 还是 Web？",
          allowCancel: true
        }
      ]
    });
  });

  test("pauses for multiple structured user questions", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();

    const session = await sessionManager.createSession({
      workingDirectory: await createWorkspaceRoot(),
      model: "MiniMax-M2.7",
      userId: "stage4-user",
      planModeEnabled: false
    });

    const executed = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry: createPlanningToolRegistry(),
      traceManager: undefined,
      session,
      turnCount: 1,
      toolCallId: "call-multi-question",
      toolName: "ask_user_question",
      toolInput: {
        questions: [
          {
            question_text: "先覆盖 CLI 还是 Web？",
            options: [
              {
                label: "先做 CLI",
                reply: "先做 CLI",
                is_recommended: true
              }
            ],
            context_note: "范围会影响测试入口。"
          },
          {
            question_text: "是否同时更新文档？",
            options: [
              {
                label: "同步更新",
                reply: "同步更新"
              }
            ],
            allow_cancel: false
          }
        ]
      },
      eventSink: undefined
    });

    expect(executed.kind).toBe("completed");
    if (executed.kind !== "completed") {
      throw new Error("expected completed result");
    }
    expect(executed.output.isError).toBe(false);

    const updatedSession = await sessionManager.getSession(session.sessionId);
    expect(updatedSession?.context.pendingUserQuestionPayload).toMatchObject({
      questions: [
        {
          questionText: "先覆盖 CLI 还是 Web？",
          options: [
            expect.objectContaining({
              label: "先做 CLI",
              isRecommended: true
            }),
            expect.objectContaining({
              label: "补充说明",
              reply: "范围会影响测试入口。"
            })
          ],
          allowCancel: true
        },
        {
          questionText: "是否同时更新文档？",
          options: [
            {
              label: "同步更新",
              reply: "同步更新"
            }
          ],
          allowCancel: false
        }
      ]
    });
  });

  test("pauses for a structured user question in plan mode and resumes on the next reply", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const emittedEvents: RunStreamEvent[] = [];
    let modelCallCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            modelCallCount += 1;
            if (modelCallCount === 1) {
              return {
                content: [
                  {
                    type: "tool_use" as const,
                    id: "call-question",
                    name: "ask_user_question",
                    input: {
                      question_text: "这次计划要覆盖 CLI 还是 Web？",
                      options: [
                        {
                          label: "先做 CLI",
                          reply: "先做 CLI",
                          description: "先把 runtime 跑通",
                          is_recommended: true
                        }
                      ],
                      context_note: "这会影响交付边界。"
                    }
                  }
                ],
                stop_reason: "tool_use" as const
              };
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: "收到，我先按 CLI 范围继续规划。"
                }
              ],
              stop_reason: "end_turn" as const
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: createPlanningToolRegistry(),
      maxTurns: 2
    });

    const session = await runtime.createSession({
      workingDirectory: workspaceRoot,
      model: "MiniMax-M2.7",
      userId: "stage4-user",
      planModeEnabled: true
    });

    const firstRun = await runtime.run({
      sessionId: session.sessionId,
      message: "先给我做个落地计划",
      eventSink(event) {
        emittedEvents.push(event);
      }
    });

    expect(firstRun.status).toBe("waiting for input");
    expect(firstRun.session.context.status).toBe("waiting_for_user_question");
    expect(firstRun.session.context.pendingUserQuestionPayload).toMatchObject({
      questions: [
        {
          questionText: "这次计划要覆盖 CLI 还是 Web？",
          options: [
            expect.objectContaining({
              label: "先做 CLI",
              reply: "先做 CLI",
              isRecommended: true
            }),
            expect.objectContaining({
              label: "补充说明",
              reply: "这会影响交付边界。"
            })
          ]
        }
      ]
    });
    expect(firstRun.finalAnswer).toContain("这次计划要覆盖 CLI 还是 Web？");
    expect(firstRun.finalAnswer).toContain("推荐");
    expect(firstRun.finalAnswer).toContain("取消");
    expect(
      emittedEvents.some((event) => event.kind === "user_question_request")
    ).toBe(true);

    const secondRun = await runtime.run({
      sessionId: session.sessionId,
      message: "先做 CLI"
    });

    expect(secondRun.status).toBe("completed");
    expect(secondRun.finalAnswer).toBe("收到，我先按 CLI 范围继续规划。");
    expect(secondRun.session.context.pendingUserQuestionPayload).toBeNull();
    expect(secondRun.session.context.status).toBe("completed");
  });

  test("rejects multiple recommended clarification options", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();

    const session = await sessionManager.createSession({
      workingDirectory: await createWorkspaceRoot(),
      model: "MiniMax-M2.7",
      userId: "stage4-user",
      planModeEnabled: true
    });

    const executed = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry: createPlanningToolRegistry(),
      traceManager: undefined,
      session,
      turnCount: 1,
      toolCallId: "call-question-too-many-recommended",
      toolName: "ask_user_question",
      toolInput: {
        question_text: "先做 CLI 还是 Web？",
        options: [
          {
            label: "先做 CLI",
            reply: "先做 CLI",
            is_recommended: true
          },
          {
            label: "先做 Web",
            reply: "先做 Web",
            is_recommended: true
          }
        ]
      },
      eventSink: undefined
    });

    expect(executed.kind).toBe("completed");
    if (executed.kind !== "completed") {
      throw new Error("expected completed result");
    }
    expect(executed.output.isError).toBe(true);
    expect(executed.output.displayText).toContain(
      "[ask_user_question] invalid input"
    );
    expect(executed.output.content).toContain(
      "At most one option can be marked as recommended."
    );
  });

  test("pauses for permission before overwriting an existing file and resumes after approval", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
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
      await writeFile(
        path.join(workspaceRoot, "existing-2.txt"),
        "before-2",
        "utf8"
      );
      const createdSession = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });
      const session = await readFileIntoSession({
        sessionManager,
        routineRepository,
        toolRegistry,
        session: createdSession,
        path: "existing.txt"
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
      expect(resumed.session.context.toolAllowList).toHaveLength(0);
      expect(resumed.session.context.shellAllowPatterns).toHaveLength(0);

      const sessionAfterApproval = await sessionManager.getSession(
        permissionRequest.session.sessionId
      );
      expect(sessionAfterApproval?.context.pendingPermissionRequest).toBeNull();
      expect(sessionAfterApproval?.context.status).toBe("running");
      expect(sessionAfterApproval?.sessionState.loopState).toBe("running");

      const secondPermissionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: resumed.session,
        turnCount: 2,
        toolCallId: "call-overwrite-2",
        toolName: "write_file",
        toolInput: {
          path: "existing-2.txt",
          content: "after-2"
        },
        eventSink: undefined
      });

      expect(secondPermissionRequest.kind).toBe("permission_request");
      if (secondPermissionRequest.kind !== "permission_request") {
        throw new Error("expected second permission request result");
      }
      expect(
        sessionAfterApproval?.messages.filter(
          (block) => block.kind === "tool call"
        ).length
      ).toBe(2);
      expect(
        sessionAfterApproval?.messages.filter(
          (block) => block.kind === "tool result"
        ).length
      ).toBe(2);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("keeps the workspace unchanged when the user rejects a destructive request", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
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

  test("asks once before explicit workspace escapes and reuses that approval within the session", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });
    const outsidePath = path.join(
      path.dirname(workspaceRoot),
      `${path.basename(workspaceRoot)}-outside.txt`
    );

    try {
      await writeFile(outsidePath, "outside", "utf8");
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
        toolCallId: "call-block",
        toolName: "read_file",
        toolInput: {
          path: path.relative(workspaceRoot, outsidePath)
        },
        eventSink: undefined
      });
      expect(permissionRequest.kind).toBe("permission_request");
      if (permissionRequest.kind !== "permission_request") {
        throw new Error("expected workspace escape permission request");
      }
      expect(permissionRequest.request.allowWorkspaceEscape).toBe(true);
      expect(permissionRequest.request.summaryText).toContain(
        "workspace 外路径"
      );

      const approved = await handlePendingPermissionReply({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: permissionRequest.session,
        message: "本会话允许 workspace 外文件操作",
        pendingPermissionRequest:
          permissionRequest.session.context.pendingPermissionRequest!,
        eventSink: undefined
      });

      expect(approved?.kind).toBe("approved");
      if (approved?.kind !== "approved") {
        throw new Error("expected approved workspace escape reply");
      }
      expect(approved.session.context.workspaceEscapeAllowed).toBe(true);
      expect(approved.session.context.toolAllowList).toHaveLength(0);
      expect(approved.toolOutputs[0]?.content).toContain("outside");

      const repeatedOutsideRead = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: approved.session,
        turnCount: 2,
        toolCallId: "call-read-outside-again",
        toolName: "read_file",
        toolInput: {
          path: path.relative(workspaceRoot, outsidePath)
        },
        eventSink: undefined
      });
      expect(repeatedOutsideRead.kind).toBe("completed");
      if (repeatedOutsideRead.kind !== "completed") {
        throw new Error("expected repeated outside read to complete");
      }
      expect(repeatedOutsideRead.output.content).toContain("outside");

      const shellRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: repeatedOutsideRead.session,
        turnCount: 3,
        toolCallId: "call-shell",
        toolName: "run_shell_command",
        toolInput: {
          action: "start",
          command: "pwd"
        },
        eventSink: undefined
      });
      expect(shellRequest.kind).toBe("permission_request");
      if (shellRequest.kind !== "permission_request") {
        throw new Error("expected shell permission request");
      }
      expect(shellRequest.request.family).toBe("workspace-shell");
      expect(shellRequest.request.permissionProfile).toBe("destructive-only");
    } finally {
      await rm(outsidePath, { force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("keeps workspace escape approval session-scoped and separate from tool allow lists", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
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

      const firstRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-list-parent",
        toolName: "list_directory",
        toolInput: {
          path: ".."
        },
        eventSink: undefined
      });

      expect(firstRequest.kind).toBe("permission_request");
      if (firstRequest.kind !== "permission_request") {
        throw new Error("expected list_directory permission request");
      }
      expect(firstRequest.request.toolName).toBe("list_directory");
      expect(firstRequest.request.allowWorkspaceEscape).toBe(true);

      const approved = await handlePendingPermissionReply({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: firstRequest.session,
        message: "确认",
        pendingPermissionRequest:
          firstRequest.session.context.pendingPermissionRequest!,
        eventSink: undefined
      });

      expect(approved?.kind).toBe("approved");
      if (approved?.kind !== "approved") {
        throw new Error("expected approved list_directory result");
      }
      expect(approved.session.context.workspaceEscapeAllowed).toBe(true);
      expect(approved.session.context.toolAllowList).not.toContain(
        "list_directory"
      );
      expect(approved.toolOutputs[0]?.isError).toBe(false);

      const newSession = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });

      const secondSessionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: newSession,
        turnCount: 1,
        toolCallId: "call-list-parent-new-session",
        toolName: "list_directory",
        toolInput: {
          path: ".."
        },
        eventSink: undefined
      });

      expect(secondSessionRequest.kind).toBe("permission_request");
      if (secondSessionRequest.kind !== "permission_request") {
        throw new Error("expected new session to ask again");
      }
      expect(secondSessionRequest.request.allowWorkspaceEscape).toBe(true);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("consumes explicit permission replies before the model sees the pending request", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });
    let modelCallCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create(input) {
            modelCallCount += 1;
            const promptText = JSON.stringify(input.messages);
            expect(promptText).not.toContain("Pending permission request:");
            expect(promptText).not.toContain("本会话允许 shell:ls *");
            return {
              content: [{ type: "text", text: "已继续执行" }]
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry
    });

    try {
      const createdSession = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });
      const session = await sessionManager.setTurnCount(
        createdSession.sessionId,
        1
      );

      const permissionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-shell",
        toolName: "run_shell_command",
        toolInput: {
          action: "start",
          command: "ls -la ../"
        },
        eventSink: undefined
      });

      expect(permissionRequest.kind).toBe("permission_request");
      if (permissionRequest.kind !== "permission_request") {
        throw new Error("expected permission_request result");
      }

      const result = await runtime.run({
        sessionId: session.sessionId,
        message: "本会话允许 shell:ls *",
        permissionReply: true,
        maxTurns: 2
      });

      expect(modelCallCount).toBe(1);
      expect(result.status).toBe("completed");
      expect(result.session.context.pendingPermissionRequest).toBeNull();
      expect(result.session.context.shellAllowPatterns).toContain("ls *");
      expect(result.toolResultCount).toBeGreaterThanOrEqual(1);
      expect(result.session.sessionState.turnCount).toBe(2);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("consumes explicit tool permission replies before the model sees the pending request", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });
    let modelCallCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create(input) {
            modelCallCount += 1;
            const promptText = JSON.stringify(input.messages);
            expect(promptText).not.toContain("Pending permission request:");
            expect(promptText).not.toContain("本会话允许 tool:delete_path");
            return {
              content: [{ type: "text", text: "已继续执行工具权限" }]
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry
    });

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );
      const createdSession = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });
      const session = await sessionManager.setTurnCount(
        createdSession.sessionId,
        1
      );

      const permissionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-delete",
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

      const result = await runtime.run({
        sessionId: session.sessionId,
        message: "本会话允许 tool:delete_path",
        permissionReply: true,
        maxTurns: 2
      });

      expect(modelCallCount).toBe(1);
      expect(result.status).toBe("completed");
      expect(result.session.context.pendingPermissionRequest).toBeNull();
      expect(result.session.context.toolAllowList).toContain("delete_path");
      expect(result.toolResultCount).toBeGreaterThanOrEqual(1);
      expect(result.session.sessionState.turnCount).toBe(2);
      const deletedContent = await readFile(
        path.join(workspaceRoot, "existing.txt"),
        "utf8"
      ).catch(() => null);
      expect(deletedContent).toBeNull();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("skips destructive file approval when yolo mode is enabled", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });
    const outsidePath = path.join(
      path.dirname(workspaceRoot),
      `${path.basename(workspaceRoot)}-outside-yolo.txt`
    );

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );
      await writeFile(outsidePath, "outside", "utf8");
      const createdSession = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user",
        yoloMode: true,
        toolAskList: ["read_file"],
        toolDenyList: ["write_file"]
      });
      const session = await readFileIntoSession({
        sessionManager,
        routineRepository,
        toolRegistry,
        session: createdSession,
        path: "existing.txt"
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

      const readResult = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session: executed.session,
        turnCount: 2,
        toolCallId: "call-yolo-read",
        toolName: "read_file",
        toolInput: {
          path: "existing.txt"
        },
        eventSink: undefined
      });
      expect(readResult.kind).toBe("completed");

      const shellRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session:
          readResult.kind === "completed"
            ? readResult.session
            : executed.session,
        turnCount: 3,
        toolCallId: "call-yolo-shell",
        toolName: "run_shell_command",
        toolInput: {
          action: "start",
          command: "pwd"
        },
        eventSink: undefined
      });
      expect(shellRequest.kind).toBe("permission_request");

      const networkRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session:
          readResult.kind === "completed"
            ? readResult.session
            : executed.session,
        turnCount: 4,
        toolCallId: "call-yolo-network",
        toolName: "make_http_request",
        toolInput: {
          url: "https://example.com"
        },
        eventSink: undefined
      });
      expect(networkRequest.kind).toBe("permission_request");

      const outsideRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session:
          readResult.kind === "completed"
            ? readResult.session
            : executed.session,
        turnCount: 5,
        toolCallId: "call-yolo-outside",
        toolName: "read_file",
        toolInput: {
          path: path.relative(workspaceRoot, outsidePath)
        },
        eventSink: undefined
      });
      expect(outsideRequest.kind).toBe("completed");
      if (outsideRequest.kind !== "completed") {
        throw new Error("expected workspace escape to complete in yolo mode");
      }
      expect(outsideRequest.output.content).toContain("outside");
    } finally {
      await rm(outsidePath, { force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("does not reset the remaining turn budget after a permission approval", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const toolRegistry = createWorkspaceToolRegistry({
      workingDirectory: workspaceRoot
    });
    let modelCallCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            modelCallCount += 1;
            return {
              content: [{ type: "text", text: "这次不该再被调用" }]
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry
    });

    try {
      await writeFile(
        path.join(workspaceRoot, "existing.txt"),
        "before",
        "utf8"
      );
      const createdSession = await sessionManager.createSession({
        workingDirectory: workspaceRoot,
        model: "MiniMax-M2.7",
        userId: "stage4-user"
      });
      const sessionWithTurnCount = await sessionManager.setTurnCount(
        createdSession.sessionId,
        1
      );
      const session = await readFileIntoSession({
        sessionManager,
        routineRepository,
        toolRegistry,
        session: sessionWithTurnCount,
        path: "existing.txt"
      });

      const permissionRequest = await executeToolAction({
        sessionManager,
        routineRepository,
        toolRegistry,
        traceManager: undefined,
        session,
        turnCount: 1,
        toolCallId: "call-budget-carry",
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

      const result = await runtime.run({
        sessionId: session.sessionId,
        message: "确认",
        permissionReply: true,
        maxTurns: 1
      });

      expect(modelCallCount).toBe(0);
      expect(result.status).toBe("completed");
      expect(result.stopReason).toBe("max_turns");
      expect(result.toolResultCount).toBe(1);
      expect(result.session.sessionState.turnCount).toBe(1);
      expect(result.session.context.pendingPermissionRequest).toBeNull();
      expect(
        await readFile(path.join(workspaceRoot, "existing.txt"), "utf8")
      ).toBe("after");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("preserves pending conflict confirmation while pausing for permission", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const sessionManager = await createPostgresTestSessionManager();
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
