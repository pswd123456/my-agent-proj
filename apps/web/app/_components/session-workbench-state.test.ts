import { describe, expect, test } from "bun:test";

import type { SessionSnapshot, SessionSummary } from "@ai-app-template/sdk";

import {
  buildSessionSettingsPatchFromUserSettings,
  buildSessionSidebarRows,
  buildMcpServersFromForm,
  applyStreamEventToSession,
  appendPatternLine,
  canInterruptSessionExecution,
  enforceSingleEnabledUserContextHookType,
  getAutoCollapsedSessionIds,
  getNextAvailableUserContextHookType,
  getSessionSidebarPageIndex,
  getVisibleSessionSidebarRows,
  getSessionDisplayState,
  mergeSessionSummary,
  normalizeSettingsFormState,
  removePatternLine,
  resolveSelectedModelId,
  toSettingsMcpFormState,
  toSettingsFormState
} from "./session-workbench-state";
import { toSessionSummary } from "@ai-app-template/sdk";

function createSessionSnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "user-1",
      status: "waiting_for_user_input",
      currentDateContext: "2026-04-24",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      activeBackgroundTaskCount: 0,
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingBackgroundNotifications: [],
      pendingConflictSummary: null,
      firstUserMessage: null,
      lastUserMessage: null
    },
    messages: [],
    sessionState: {
      loopState: "waiting for input",
      turnCount: 0,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false,
      historyCompactionsSinceFullCompaction: 0
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: "2026-04-24T00:00:00.000Z"
  };
}

function createSessionSummary(
  sessionId: string,
  updatedAt: string,
  parentSessionId?: string | null
): SessionSummary {
  return {
    sessionId,
    parentSessionId: parentSessionId ?? null,
    updatedAt,
    workingDirectory: "/tmp/workspace",
    yoloMode: false,
    model: "MiniMax-M2.7",
    loopState: "waiting for input",
    turnCount: 0,
    pendingToolCallIds: [],
    interruptRequested: false,
    pendingPermission: false,
    pendingConfirmation: false,
    pendingUserQuestion: false,
    pendingBackgroundNotificationCount: 0,
    activeBackgroundTaskCount: 0,
    status: "waiting_for_user_input",
    firstUserMessage: null,
    lastUserMessage: null
  };
}

describe("canInterruptSessionExecution", () => {
  test("returns true while submitting even before the session snapshot flips to running", () => {
    expect(
      canInterruptSessionExecution({
        session: createSessionSnapshot(),
        submitting: true
      })
    ).toBe(true);
  });

  test("returns true for an active running session", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.sessionState.loopState = "running";

    expect(
      canInterruptSessionExecution({
        session,
        submitting: false
      })
    ).toBe(true);
  });

  test("returns true for a waiting permission pause", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_permission";

    expect(
      canInterruptSessionExecution({
        session,
        submitting: false
      })
    ).toBe(true);
  });

  test("returns false for an idle session", () => {
    const session = createSessionSnapshot();

    expect(
      canInterruptSessionExecution({
        session,
        submitting: false
      })
    ).toBe(false);
  });

  test("returns false after a session has been interrupted", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_user_input";
    session.sessionState.loopState = "interrupted";

    expect(
      canInterruptSessionExecution({
        session,
        submitting: false
      })
    ).toBe(false);
  });

  test("returns false after a session has failed", () => {
    const session = createSessionSnapshot();
    session.context.status = "failed";
    session.sessionState.loopState = "failed";

    expect(
      canInterruptSessionExecution({
        session,
        submitting: false
      })
    ).toBe(false);
  });
});

describe("model selection state", () => {
  test("prefers the persisted session model over current user defaults", () => {
    const session = createSessionSnapshot();
    session.model = "deepseek-v4-pro";
    const settingsForm = toSettingsFormState({
      userId: "user-1",
      workingDirectory: "agent-workspace",
      model: "MiniMax-M2.7",
      thinkingEffort: "high",
      yoloMode: false,
      contextWindow: 200_000,
      maxTurns: 50,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      workspaceSkillSettings: [],
      userContextHooks: [],
      debugConversationView: false,
      userCustomPrompt: "",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z"
    });

    expect(
      resolveSelectedModelId({
        session,
        settingsForm
      })
    ).toBe("deepseek-v4-pro");
  });

  test("syncing user settings into a session does not include model", () => {
    expect(
      buildSessionSettingsPatchFromUserSettings({
        userId: "user-1",
        workingDirectory: "agent-workspace",
        model: "deepseek-v4-pro",
        thinkingEffort: "max",
        yoloMode: true,
        contextWindow: 123_456,
        maxTurns: 77,
        shellAllowPatterns: ["git *"],
        shellDenyPatterns: ["rm *"],
        toolAllowList: ["read_file"],
        toolAskList: ["write_file"],
        toolDenyList: ["delete_path"],
        enabledCapabilityPacks: ["workspace"],
        workspaceSkillSettings: [],
        userContextHooks: [],
        debugConversationView: true,
        userCustomPrompt: "先确认上下文。",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      })
    ).toEqual({
      yoloMode: true,
      thinkingEffort: "max",
      shellAllowPatterns: ["git *"],
      shellDenyPatterns: ["rm *"],
      toolAllowList: ["read_file"],
      toolAskList: ["write_file"],
      toolDenyList: ["delete_path"],
      enabledCapabilityPacks: ["workspace"]
    });
  });
});

describe("MCP settings state", () => {
  test("round-trips server and child tool enabled state", () => {
    const form = toSettingsMcpFormState({
      workingDirectory: "/tmp/workspace",
      configPath: "/tmp/workspace/.agent/.config.toml",
      foundConfig: true,
      diagnostics: [],
      servers: [
        {
          name: "local_echo",
          transport: "stdio",
          enabled: true,
          disabledTools: ["write"],
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "$TOKEN" }
        }
      ],
      serverStatuses: [
        {
          name: "local_echo",
          transport: "stdio",
          status: "loaded",
          toolNames: ["mcp__local_echo__local_echo__echo__echo"],
          tools: [
            {
              name: "echo",
              runtimeName: "mcp__local_echo__local_echo__echo__echo",
              description: "Echo the message.",
              enabled: true
            },
            {
              name: "write",
              runtimeName: "mcp__local_echo__local_echo__write__write",
              description: null,
              enabled: false
            }
          ]
        }
      ]
    });

    expect(form.servers[0]?.tools.map((tool) => tool.name)).toEqual([
      "echo",
      "write"
    ]);
    expect(buildMcpServersFromForm(form)).toEqual([
      {
        name: "local_echo",
        transport: "stdio",
        enabled: true,
        disabledTools: ["write"],
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "$TOKEN" }
      }
    ]);
  });
});

describe("settings shell patterns", () => {
  test("appends one permission-approved pattern without duplicating existing lines", () => {
    expect(appendPatternLine("git *\nls *", "git *")).toBe("git *\nls *");
    expect(appendPatternLine("git *\nls *", " bun * ")).toBe(
      "git *\nls *\nbun *"
    );
  });

  test("removes one allow pattern from the editable settings text", () => {
    expect(removePatternLine("git *\nls *\nbun *", "ls *")).toBe(
      "git *\nbun *"
    );
  });
});

describe("settings user context hooks", () => {
  test("keeps the priority hook enabled when resolving duplicate active types", () => {
    expect(
      enforceSingleEnabledUserContextHookType(
        [
          {
            id: "hook-1",
            event: "run_started",
            behavior: "context",
            title: "Old",
            content: "旧 context。",
            enabled: true
          },
          {
            id: "hook-2",
            event: "run_started",
            behavior: "context",
            title: "New",
            content: "新 context。",
            enabled: true
          }
        ],
        "hook-2"
      ).map((hook) => ({ id: hook.id, enabled: hook.enabled }))
    ).toEqual([
      { id: "hook-1", enabled: false },
      { id: "hook-2", enabled: true }
    ]);
  });

  test("normalizes duplicate active hook types before saving settings", () => {
    const settingsForm = toSettingsFormState({
      userId: "user-1",
      workingDirectory: "agent-workspace",
      model: "MiniMax-M2.7",
      thinkingEffort: "high",
      yoloMode: false,
      contextWindow: 200_000,
      maxTurns: 50,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      workspaceSkillSettings: [],
      userContextHooks: [
        {
          id: "hook-1",
          event: "run_started",
          behavior: "context",
          title: "One",
          content: "第一条。",
          enabled: true
        },
        {
          id: "hook-2",
          event: "run_started",
          behavior: "context",
          title: "Two",
          content: "第二条。",
          enabled: true
        }
      ],
      debugConversationView: false,
      userCustomPrompt: "  保留这条提示。  ",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:00:00.000Z"
    });

    expect(
      normalizeSettingsFormState(settingsForm).userContextHooks.map((hook) => ({
        id: hook.id,
        enabled: hook.enabled
      }))
    ).toEqual([
      { id: "hook-1", enabled: true },
      { id: "hook-2", enabled: false }
    ]);
    expect(normalizeSettingsFormState(settingsForm).userCustomPrompt).toBe(
      "保留这条提示。"
    );
  });

  test("finds the next hook type without reusing an enabled type", () => {
    expect(
      getNextAvailableUserContextHookType([
        {
          id: "hook-1",
          event: "session_started",
          behavior: "context",
          title: "Session",
          content: "会话开始。",
          enabled: true
        }
      ])
    ).toEqual({
      behavior: "context",
      event: "run_started"
    });
  });

  test("normalizes subagent hooks with a default blocking wait mode", () => {
    const settingsForm = toSettingsFormState({
      userId: "user-1",
      workingDirectory: "agent-workspace",
      model: "MiniMax-M2.7",
      thinkingEffort: "high",
      yoloMode: false,
      contextWindow: 200_000,
      maxTurns: 50,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      workspaceSkillSettings: [],
      userContextHooks: [
        {
          id: "hook-subagent",
          event: "run_started",
          behavior: "subagent",
          title: "Background research",
          content: "先整理背景资料。",
          enabled: true
        }
      ],
      debugConversationView: false,
      userCustomPrompt: "",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });

    expect(normalizeSettingsFormState(settingsForm).userContextHooks).toEqual([
      {
        id: "hook-subagent",
        event: "run_started",
        behavior: "subagent",
        waitMode: "blocking",
        title: "Background research",
        content: "先整理背景资料。",
        enabled: true
      }
    ]);
  });
});

describe("getSessionDisplayState", () => {
  test("prefers permission pause over generic waiting input", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_permission";
    session.context.pendingPermissionRequest = {
      toolCallId: "call-1",
      toolName: "read_file",
      toolInput: { path: "../README.md" },
      family: "workspace-file",
      permissionProfile: "always-ask-user",
      summaryText: "读取工作区外文件",
      createdAt: "2026-04-24T00:00:00.000Z"
    };

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(
          session.context.pendingConfirmationPayload
        ),
        pendingUserQuestion: Boolean(session.context.pendingUserQuestionPayload)
      })
    ).toMatchObject({
      label: "等待权限确认",
      isWaitingForUser: true,
      isActiveExecution: false
    });
  });

  test("describes conflict confirmation separately from plain input", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_conflict_confirmation";
    session.context.pendingConfirmationPayload = {
      summaryText: "已有日程冲突",
      proposedItems: [],
      createdAt: "2026-04-24T00:00:00.000Z"
    };

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(
          session.context.pendingConfirmationPayload
        ),
        pendingUserQuestion: Boolean(session.context.pendingUserQuestionPayload)
      }).label
    ).toBe("等待冲突确认");
  });

  test("describes pending clarification separately from plain input", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_user_question";
    session.context.pendingUserQuestionPayload = {
      questions: [
        {
          questionText: "先做 CLI 还是 Web？",
          options: []
        }
      ],
      createdAt: "2026-04-24T00:00:00.000Z"
    };

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(
          session.context.pendingConfirmationPayload
        ),
        pendingUserQuestion: Boolean(session.context.pendingUserQuestionPayload)
      }).label
    ).toBe("等待澄清");
  });

  test("keeps tool-result waits active even before context status refreshes", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.sessionState.loopState = "waiting for tool result";
    session.sessionState.pendingToolCallIds = ["call-1", "call-2"];

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(
          session.context.pendingConfirmationPayload
        ),
        pendingUserQuestion: Boolean(session.context.pendingUserQuestionPayload)
      })
    ).toMatchObject({
      label: "等待工具结果 · 2",
      isActiveExecution: true
    });
  });

  test("shows executing when a resumed tool run has no pending ids", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.sessionState.loopState = "waiting for tool result";
    session.sessionState.pendingToolCallIds = [];

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(
          session.context.pendingConfirmationPayload
        ),
        pendingUserQuestion: Boolean(session.context.pendingUserQuestionPayload)
      })
    ).toMatchObject({
      label: "执行中",
      isActiveExecution: true,
      isWaitingForUser: false
    });
  });
});

describe("applyStreamEventToSession", () => {
  test("advances the UI session immediately after permission approval", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_permission";
    session.context.pendingPermissionRequest = {
      toolCallId: "call-1",
      toolName: "read_file",
      toolInput: { path: "../README.md" },
      family: "workspace-file",
      permissionProfile: "always-ask-user",
      summaryText: "读取工作区外文件",
      createdAt: "2026-04-24T00:00:00.000Z"
    };
    session.sessionState.loopState = "waiting for input";

    const next = applyStreamEventToSession(session, {
      kind: "permission_approved",
      sessionId: session.sessionId,
      createdAt: "2026-04-24T00:00:01.000Z",
      turnCount: 1,
      toolCallId: "call-1",
      toolName: "read_file",
      request: session.context.pendingPermissionRequest
    });

    expect(next.context.status).toBe("running");
    expect(next.context.pendingPermissionRequest).toBeNull();
    expect(next.sessionState.loopState).toBe("waiting for tool result");
    expect(next.sessionState.pendingToolCallIds).toEqual(["call-1"]);
  });

  test("hydrates todo state from get_todo_list results before run completion", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.sessionState.loopState = "waiting for tool result";
    session.sessionState.pendingToolCallIds = ["tool-call-1"];

    const next = applyStreamEventToSession(session, {
      kind: "tool_result",
      sessionId: session.sessionId,
      createdAt: "2026-04-26T00:00:01.000Z",
      turnCount: 1,
      toolCallId: "tool-call-1",
      toolName: "get_todo_list",
      isError: false,
      output: JSON.stringify({
        ok: true,
        code: "TODO_LIST_READ",
        message: "Read the current session todo list.",
        data: {
          items: [
            {
              id: "item-1",
              content: "补前端状态",
              status: "in_progress",
              createdAt: "2026-04-26T00:00:00.000Z",
              updatedAt: "2026-04-26T00:00:01.000Z"
            }
          ],
          activeItemId: "item-1",
          lastUpdatedAt: "2026-04-26T00:00:01.000Z"
        }
      })
    });

    expect(next.context.todoState).toEqual({
      items: [
        {
          id: "item-1",
          content: "补前端状态",
          status: "in_progress",
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:01.000Z"
        }
      ],
      activeItemId: "item-1",
      lastUpdatedAt: "2026-04-26T00:00:01.000Z"
    });
    expect(next.sessionState.pendingToolCallIds).toEqual([]);
    expect(next.sessionState.loopState).toBe("running");
  });

  test("applies structured user question events immediately", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.sessionState.loopState = "running";

    const next = applyStreamEventToSession(session, {
      kind: "user_question_request",
      sessionId: session.sessionId,
      createdAt: "2026-04-26T00:00:01.000Z",
      turnCount: 1,
      question: {
        questions: [
          {
            questionText: "先做 CLI 还是 Web？",
            options: [
              {
                label: "先做 CLI",
                reply: "先做 CLI"
              }
            ]
          }
        ],
        createdAt: "2026-04-26T00:00:01.000Z"
      }
    });

    expect(next.context.status).toBe("waiting_for_user_question");
    expect(
      next.context.pendingUserQuestionPayload?.questions[0]?.questionText
    ).toBe("先做 CLI 还是 Web？");
    expect(next.sessionState.loopState).toBe("waiting for input");
  });
});

describe("buildSessionSidebarRows", () => {
  test("nests child sessions under their parent session", () => {
    const rows = buildSessionSidebarRows([
      createSessionSummary("parent", "2026-04-24T02:00:00.000Z"),
      createSessionSummary("child", "2026-04-24T03:00:00.000Z", "parent"),
      createSessionSummary("sibling", "2026-04-24T01:00:00.000Z")
    ]);

    expect(rows.map((row) => row.session.sessionId)).toEqual([
      "parent",
      "child",
      "sibling"
    ]);
    expect(rows[0]?.childCount).toBe(1);
    expect(rows[1]?.depth).toBe(1);
    expect(rows[2]?.depth).toBe(0);
  });

  test("keeps a newly inserted root session first when timestamps tie", () => {
    const existing = createSessionSnapshot();
    existing.sessionId = "session-old";
    existing.updatedAt = "2026-04-24T02:00:00.000Z";

    const created = createSessionSnapshot();
    created.sessionId = "session-new";
    created.updatedAt = "2026-04-24T02:00:00.000Z";

    const sessions = mergeSessionSummary(
      [toSessionSummary(existing)],
      created,
      toSessionSummary
    );
    const rows = buildSessionSidebarRows(sessions);

    expect(rows.map((row) => row.session.sessionId)).toEqual([
      "session-new",
      "session-old"
    ]);
  });

  test("auto-collapses completed parent sessions with children", () => {
    const rows = buildSessionSidebarRows([
      {
        ...createSessionSummary("parent", "2026-04-24T02:00:00.000Z"),
        loopState: "completed",
        status: "completed"
      },
      createSessionSummary("child", "2026-04-24T03:00:00.000Z", "parent"),
      createSessionSummary("sibling", "2026-04-24T01:00:00.000Z")
    ]);

    expect([...getAutoCollapsedSessionIds(rows)]).toEqual(["parent"]);
  });

  test("hides hook child sessions unless debug conversation view is enabled", () => {
    const sessions = [
      createSessionSummary("parent", "2026-04-24T02:00:00.000Z"),
      {
        ...createSessionSummary(
          "hook-child",
          "2026-04-24T03:00:00.000Z",
          "parent"
        ),
        parentRelationKind: "hook_subagent" as const,
        parentSessionTaskKind: "hook_subagent" as const
      }
    ];

    expect(
      buildSessionSidebarRows(sessions).map((row) => row.session.sessionId)
    ).toEqual(["parent"]);
    expect(
      buildSessionSidebarRows(sessions, {
        debugConversationView: true
      }).map((row) => row.session.sessionId)
    ).toEqual(["parent", "hook-child"]);
  });
});

describe("getVisibleSessionSidebarRows", () => {
  test("limits the sidebar to the first 20 rows by default", () => {
    const rows = buildSessionSidebarRows(
      Array.from({ length: 24 }, (_, index) =>
        createSessionSummary(
          `session-${index + 1}`,
          `2026-04-${String(24 - index).padStart(2, "0")}T00:00:00.000Z`
        )
      )
    );

    const visibleRows = getVisibleSessionSidebarRows(rows, {
      pageCount: 1,
      visibleCount: 20
    });

    expect(visibleRows).toHaveLength(20);
    expect(visibleRows[0]?.session.sessionId).toBe("session-1");
    expect(visibleRows.at(-1)?.session.sessionId).toBe("session-20");
  });

  test("appends one more batch when the page count increases", () => {
    const rows = buildSessionSidebarRows(
      Array.from({ length: 41 }, (_, index) =>
        createSessionSummary(
          `session-${index + 1}`,
          `2026-03-${String(41 - index).padStart(2, "0")}T00:00:00.000Z`
        )
      )
    );

    const visibleRows = getVisibleSessionSidebarRows(rows, {
      pageCount: 2,
      visibleCount: 20
    });

    expect(visibleRows).toHaveLength(40);
    expect(visibleRows[0]?.session.sessionId).toBe("session-1");
    expect(visibleRows.at(-1)?.session.sessionId).toBe("session-40");
  });

  test("hides child rows when the parent session group is collapsed", () => {
    const rows = buildSessionSidebarRows([
      {
        ...createSessionSummary("parent", "2026-04-24T02:00:00.000Z"),
        loopState: "completed",
        status: "completed"
      },
      createSessionSummary("child", "2026-04-24T03:00:00.000Z", "parent"),
      createSessionSummary("sibling", "2026-04-24T01:00:00.000Z")
    ]);

    const visibleRows = getVisibleSessionSidebarRows(rows, {
      pageCount: 1,
      visibleCount: 20,
      collapsedSessionIds: new Set(["parent"])
    });

    expect(visibleRows.map((row) => row.session.sessionId)).toEqual([
      "parent",
      "sibling"
    ]);
  });
});

describe("getSessionSidebarPageIndex", () => {
  test("maps an older selected session to the batch that contains it", () => {
    const rows = buildSessionSidebarRows(
      Array.from({ length: 41 }, (_, index) =>
        createSessionSummary(
          `session-${index + 1}`,
          `2026-03-${String(41 - index).padStart(2, "0")}T00:00:00.000Z`
        )
      )
    );

    expect(
      getSessionSidebarPageIndex(rows, {
        selectedSessionId: "session-24",
        visibleCount: 20
      })
    ).toBe(1);
  });
});
