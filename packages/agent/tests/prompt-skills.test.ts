import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAskUserQuestionTool } from "../src/tools/ask-user-question.js";
import { createCreateRoutineTool } from "../src/tools/create-routine.js";
import { createEditTaskBriefTool } from "../src/tools/edit-task-brief.js";
import { createReadTaskBriefTool } from "../src/tools/read-task-brief.js";
import { createReplaceTaskBriefTool } from "../src/tools/replace-task-brief.js";
import { createReplaceTodoListTool } from "../src/tools/replace-todo-list.js";
import { createSearchTaskBriefTool } from "../src/tools/search-task-brief.js";
import { createWriteFileTool } from "../src/tools/write-file.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { resolveUserContextHookSections } from "../src/context-hooks.js";
import {
  buildPromptRequestMessages,
  compactHistoryBlocks,
  createPromptBuilder,
  summarizePromptEnvelopeComposition,
  toAnthropicMessages
} from "../src/prompt.js";
import type { ConversationBlock, SessionSnapshot } from "../src/types.js";

function createSessionSnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "test-user",
      status: "completed",
      yoloMode: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      fullCompactionState: null,
      pendingConflictSummary: null,
      currentDateContext: "2026-04-22",
      firstUserMessage: null,
      lastUserMessage: null,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      enabledCapabilityPacks: ["workspace", "schedule"],
      pendingBackgroundNotifications: []
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
    updatedAt: new Date().toISOString()
  };
}

describe("PromptBuilder skill context", () => {
  test("serializes assistant thinking before the matching tool call", () => {
    const messages = toAnthropicMessages([
      {
        id: "user-1",
        kind: "user",
        content: "Read the file.",
        createdAt: "2026-04-25T00:00:00.000Z"
      },
      {
        id: "thinking-1",
        kind: "assistant thinking",
        content: "I need to inspect the requested file before answering.",
        signature: "thinking-signature-1",
        createdAt: "2026-04-25T00:00:01.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "README.md" },
        state: "pending",
        createdAt: "2026-04-25T00:00:02.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "read_file",
        output: "Hello",
        isError: false,
        state: "success",
        createdAt: "2026-04-25T00:00:03.000Z"
      }
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toEqual([
      {
        type: "thinking",
        thinking: "I need to inspect the requested file before answering.",
        signature: "thinking-signature-1"
      },
      {
        type: "tool_use",
        id: "call-1",
        name: "read_file",
        input: { path: "README.md" }
      }
    ]);
    expect(messages[2]?.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call-1"
    });
  });

  test("injects a skill list into runtime context messages", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry();

    const promptEnvelope = promptBuilder.build(
      session,
      toolRegistry,
      undefined,
      [
        {
          name: "repo_reader",
          description: "Read repository structure before implementation.",
          relativePath: ".agent/skills/repo-reader/SKILL.md"
        }
      ]
    );

    expect(promptEnvelope.system).toContain(
      "Actively utilize the skills listed in the runtime context"
    );
    expect(promptEnvelope.system).toContain(
      "Only rely on skills explicitly listed in the current runtime context"
    );
    expect(promptEnvelope.system).toContain("@relative/path");
    expect(promptEnvelope.system).toContain("#skill_name");
    expect(promptEnvelope.runtimeContextMessages).toHaveLength(2);
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[0])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[0])).toContain(
      "repo_reader"
    );
    expect(
      JSON.stringify(promptEnvelope.runtimeContextMessages[0])
    ).not.toContain(".agent/skills/repo-reader/SKILL.md");
  });

  test("injects root AGENTS.md instructions into runtime context when provided", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry();

    const promptEnvelope = promptBuilder.build(
      session,
      toolRegistry,
      {
        workspaceInstructions: {
          relativePath: "AGENTS.md",
          content: "# AGENTS.md\n\n- Read scoped instructions first.\n"
        }
      },
      []
    );

    expect(promptEnvelope.system).toContain(
      "Follow workspace instructions listed in the runtime context"
    );
    expect(promptEnvelope.runtimeContextMessages).toHaveLength(3);
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[0])).toContain(
      "Workspace instructions from AGENTS.md:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[0])).toContain(
      "Read scoped instructions first."
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(promptEnvelope.cacheKey).toBe(
      promptBuilder.build(session, toolRegistry, {
        workspaceInstructions: {
          relativePath: "AGENTS.md",
          content: "# AGENTS.md\n\n- Different runtime instruction.\n"
        }
      }).cacheKey
    );
  });

  test("injects user context hooks into runtime context without changing the cache key", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry();
    const firstSections = resolveUserContextHookSections({
      hooks: [
        {
          id: "hook-1",
          event: "run_started",
          title: "Profile",
          content: "先看我的长期偏好。",
          enabled: true
        },
        {
          id: "hook-2",
          event: "run_end",
          behavior: "message",
          title: "Close",
          content: "结束时补一条 next step。",
          enabled: true
        }
      ],
      session
    });
    const secondSections = resolveUserContextHookSections({
      hooks: [
        {
          id: "hook-1",
          event: "run_started",
          title: "Profile",
          content: "这里换成另一条用户 context。",
          enabled: true
        }
      ],
      session
    });

    const first = promptBuilder.build(session, toolRegistry, {
      contextHooks: firstSections
    });
    const second = promptBuilder.build(session, toolRegistry, {
      contextHooks: secondSections
    });

    expect(JSON.stringify(first.runtimeContextMessages[0])).toContain(
      "User context hooks for run start:"
    );
    expect(JSON.stringify(first.runtimeContextMessages[0])).toContain(
      "先看我的长期偏好。"
    );
    expect(JSON.stringify(first.runtimeContextMessages)).not.toContain(
      "User context hooks for run end:"
    );
    expect(JSON.stringify(first.runtimeContextMessages)).not.toContain(
      "结束时补一条 next step。"
    );
    expect(first.cacheKey).toBe(second.cacheKey);
  });

  test("does not inject current date or time into prompt context", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry();

    const promptEnvelope = promptBuilder.build(session, toolRegistry);

    expect(JSON.stringify(promptEnvelope.prefixMessages[0])).not.toContain(
      "Current date context:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages)).not.toContain(
      "Current date context:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages)).not.toContain(
      "Current local datetime:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages)).not.toContain(
      "Current timezone:"
    );
  });

  test("does not expose tool permission state in model-visible context", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_permission";
    session.context.yoloMode = true;
    session.context.pendingPermissionRequest = {
      toolCallId: "call-shell",
      toolName: "run_shell_command",
      toolInput: { command: "rm -rf tmp" },
      family: "workspace-shell",
      permissionProfile: "destructive-only",
      summaryText: "Run a destructive shell command.",
      createdAt: "2026-04-29T00:00:00.000Z"
    };
    session.context.pendingBackgroundNotifications = [
      {
        id: "notification-1",
        kind: "task_waiting",
        taskId: "task-1",
        taskKind: "delegate",
        childSessionId: "child-session-1",
        title: "Background delegate",
        summary: "Subagent needs permission.",
        content: "Subagent needs a permission decision.",
        createdAt: "2026-04-29T00:00:00.000Z",
        requiresMainAgentReply: true,
        expectedParentReply: "permission_decision",
        request: {
          kind: "permission_request",
          summary: "Subagent needs permission.",
          data: { toolName: "run_shell_command" }
        }
      }
    ];

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());
    const modelVisibleContext = JSON.stringify([
      ...promptEnvelope.prefixMessages,
      ...promptEnvelope.runtimeContextMessages
    ]);

    expect(modelVisibleContext).not.toContain("YOLO mode:");
    expect(modelVisibleContext).not.toContain("Session status:");
    expect(modelVisibleContext).not.toContain("waiting_for_permission");
    expect(modelVisibleContext).not.toContain("Pending permission request:");
    expect(modelVisibleContext).not.toContain("permission_decision");
    expect(modelVisibleContext).not.toContain("run_shell_command");
    expect(modelVisibleContext).toContain(
      "Pending background notifications: none"
    );
  });

  test("orders stable context before runtime context and keeps tool results at the tail", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    session.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "Inspect the current workspace.",
        createdAt: "2026-04-29T00:00:00.000Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: "I will inspect the workspace root.",
        createdAt: "2026-04-29T00:00:01.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "list_directory",
        input: { path: "." },
        state: "completed",
        createdAt: "2026-04-29T00:00:02.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "list_directory",
        output: "README.md\npackages",
        isError: false,
        state: "success",
        createdAt: "2026-04-29T00:00:03.000Z"
      }
    ];

    const promptEnvelope = promptBuilder.build(
      session,
      new ToolRegistry(),
      {
        workspaceInstructions: {
          relativePath: "AGENTS.md",
          content: "# AGENTS.md\n\n- Stable workspace instruction.\n"
        }
      },
      [
        {
          name: "repo_reader",
          description: "Read repository structure before implementation.",
          relativePath: ".agent/skills/repo-reader/SKILL.md"
        }
      ]
    );
    const requestMessages = buildPromptRequestMessages(promptEnvelope);
    const firstHistoryIndex =
      promptEnvelope.prefixMessages.length +
      promptEnvelope.runtimeContextMessages.length;

    expect(JSON.stringify(requestMessages[0])).toContain("Workspace root:");
    expect(JSON.stringify(requestMessages[1])).toContain(
      "Workspace instructions from AGENTS.md:"
    );
    expect(JSON.stringify(requestMessages[2])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(JSON.stringify(requestMessages[3])).toContain(
      "Runtime context for this run:"
    );
    expect(JSON.stringify(requestMessages[firstHistoryIndex])).toContain(
      "Inspect the current workspace."
    );
    expect(requestMessages.at(-1)?.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call-1",
      content: "README.md\npackages"
    });
  });

  test("injects task brief binding context without replaying brief content", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "prompt-brief-"));

    try {
      const taskBriefPath = path.join(
        workspaceRoot,
        ".agent",
        "plans",
        "session-1",
        "jump_joy_web_game.md"
      );
      await mkdir(path.dirname(taskBriefPath), { recursive: true });
      await writeFile(
        taskBriefPath,
        "# Task Brief\n\n## Goal\nFirst draft\n",
        "utf8"
      );

      const promptBuilder = createPromptBuilder();
      const session = createSessionSnapshot();
      session.workingDirectory = workspaceRoot;
      session.context.planModeEnabled = true;
      session.context.taskBriefPath = taskBriefPath;

      const first = promptBuilder.build(session, new ToolRegistry());

      await writeFile(
        taskBriefPath,
        "# Task Brief\n\n## Goal\nSecond draft\n",
        "utf8"
      );
      const second = promptBuilder.build(session, new ToolRegistry());

      expect(JSON.stringify(first.runtimeContextMessages[0])).toContain(
        "Plan mode prompt for this run:"
      );
      expect(JSON.stringify(first.runtimeContextMessages[2])).toContain(
        "Plan mode: enabled"
      );
      expect(JSON.stringify(first.runtimeContextMessages[2])).toContain(
        "Task brief binding: bound_named"
      );
      expect(JSON.stringify(first.runtimeContextMessages[2])).toContain(
        "Task brief next write: omit plan_name unless you are reusing jump_joy_web_game.md."
      );
      expect(JSON.stringify(first.runtimeContextMessages[2])).not.toContain(
        "First draft"
      );
      expect(JSON.stringify(second.runtimeContextMessages[2])).not.toContain(
        "Second draft"
      );
      expect(first.runtimeContextMessages[2]).toEqual(
        second.runtimeContextMessages[2]
      );
      expect(first.cacheKey).toBe(second.cacheKey);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("hides ordinary workspace file mutations and todo tools from the prompt tool surface in plan mode", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "prompt-tools-"));

    try {
      const promptBuilder = createPromptBuilder();
      const session = createSessionSnapshot();
      session.workingDirectory = workspaceRoot;
      session.context.planModeEnabled = true;
      session.context.taskBriefPath = path.join(
        workspaceRoot,
        ".agent",
        "plans",
        "session-1",
        "plan.md"
      );

      const toolRegistry = new ToolRegistry()
        .register(createEditTaskBriefTool())
        .register(createReadFileTool(workspaceRoot))
        .register(createReadTaskBriefTool())
        .register(createReplaceTodoListTool())
        .register(createWriteFileTool(workspaceRoot))
        .register(createReplaceTaskBriefTool())
        .register(createSearchTaskBriefTool());

      const promptEnvelope = promptBuilder.build(session, toolRegistry);

      expect(promptEnvelope.tools.map((tool) => tool.name)).toEqual([
        "edit_task_brief",
        "read_file",
        "read_task_brief",
        "replace_task_brief",
        "search_task_brief"
      ]);
      expect(JSON.stringify(promptEnvelope.prefixMessages[0])).toContain(
        "Mounted tools: edit_task_brief, read_file, read_task_brief, replace_task_brief, search_task_brief"
      );
      expect(JSON.stringify(promptEnvelope.prefixMessages[0])).not.toContain(
        "write_file"
      );
      expect(JSON.stringify(promptEnvelope.prefixMessages[0])).not.toContain(
        "replace_todo_list"
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("always exposes ask_user_question and adds plan mode guidance when enabled", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "prompt-question-")
    );

    try {
      const promptBuilder = createPromptBuilder();
      const session = createSessionSnapshot();
      session.workingDirectory = workspaceRoot;

      const toolRegistry = new ToolRegistry().register(
        createAskUserQuestionTool()
      );

      const before = promptBuilder.build(session, toolRegistry);

      session.context.planModeEnabled = true;
      const after = promptBuilder.build(session, toolRegistry);

      expect(before.tools.map((tool) => tool.name)).toEqual([
        "ask_user_question"
      ]);
      expect(JSON.stringify(before.prefixMessages[0])).toContain(
        "Mounted tools: ask_user_question"
      );
      expect(after.tools.map((tool) => tool.name)).toEqual([
        "ask_user_question"
      ]);
      expect(JSON.stringify(after.prefixMessages[0])).toContain(
        "Mounted tools: ask_user_question"
      );
      expect(JSON.stringify(after.runtimeContextMessages[0])).toContain(
        "Use ask_user_question for requirement clarification"
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("teaches the model to page large files and exposes offset-limit on read_file", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "prompt-read-file-")
    );

    try {
      const promptBuilder = createPromptBuilder();
      const session = createSessionSnapshot();
      session.workingDirectory = workspaceRoot;

      const toolRegistry = new ToolRegistry().register(
        createReadFileTool(workspaceRoot)
      );

      const promptEnvelope = promptBuilder.build(session, toolRegistry);
      const readFileTool = promptEnvelope.tools.find(
        (tool) => tool.name === "read_file"
      );

      expect(promptEnvelope.system).toContain(
        "When both search_text and read_file are available, you MUST use search_text first before read_file"
      );
      expect(promptEnvelope.system).toContain(
        "Do not begin context gathering with broad read_file"
      );
      expect(promptEnvelope.system).toContain(
        "you MUST use read_file with offset and limit or startLine/endLine"
      );
      expect(promptEnvelope.system).toContain(
        "continue with the next adjacent window instead of rereading from the beginning"
      );
      expect(promptEnvelope.system).toContain(
        "read a narrow window around the relevant section instead of reading the whole file"
      );
      expect(promptEnvelope.system).toContain(
        "If read_file reports that a file is unchanged since the last read"
      );
      expect(readFileTool?.description).toContain("use search_text first");
      expect(readFileTool?.description).toContain(
        "MUST page with offset and limit"
      );
      expect(JSON.stringify(readFileTool?.input_schema)).toContain('"offset"');
      expect(JSON.stringify(readFileTool?.input_schema)).toContain('"limit"');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("renders none when no skills are available", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());

    expect(promptEnvelope.system).toContain("You are a personal assistant.");
    expect(promptEnvelope.system).not.toMatch(
      /scheduling agent.*routine manager/i
    );
    expect(promptEnvelope.runtimeContextMessages).toHaveLength(2);
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[0])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[0])).toContain(
      "none"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages)).not.toContain(
      "Session todo state:"
    );
  });

  test("does not replay the active todo summary into runtime context messages", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    session.context.todoState = {
      items: [
        {
          id: "todo-1",
          content: "Inspect runtime/session boundaries",
          status: "in_progress",
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        },
        {
          id: "todo-2",
          content: "Write the todo tools",
          status: "pending",
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        },
        {
          id: "todo-3",
          content: "Old finished step",
          status: "done",
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ],
      activeItemId: "todo-1",
      lastUpdatedAt: "2026-04-26T00:00:00.000Z"
    };

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());
    const runtimeText = JSON.stringify(promptEnvelope.runtimeContextMessages);

    expect(promptEnvelope.system).toContain(
      "When a structured todo list is available"
    );
    expect(runtimeText).not.toContain("Session todo state:");
    expect(runtimeText).not.toContain(
      "Active item: todo-1 - Inspect runtime/session boundaries"
    );
    expect(runtimeText).not.toContain("Write the todo tools");
  });

  test("injects a soft warning when the turn budget is at least 90% used", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const promptEnvelope = promptBuilder.build(session, new ToolRegistry(), {
      currentTurnCount: 9,
      maxTurns: 10
    });

    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "Turn budget is nearly exhausted. Consolidate work, avoid exploratory detours, and prefer a final answer or a crisp blocking question."
    );
    expect(promptEnvelope.dynamicPromptMessages).toEqual([
      "Turn budget is nearly exhausted. Consolidate work, avoid exploratory detours, and prefer a final answer or a crisp blocking question."
    ]);
  });

  test("does not inject a soft warning before the 90% turn-budget threshold", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const promptEnvelope = promptBuilder.build(session, new ToolRegistry(), {
      currentTurnCount: 8,
      maxTurns: 10
    });

    expect(
      JSON.stringify(promptEnvelope.runtimeContextMessages[1])
    ).not.toContain("Turn budget is nearly exhausted.");
    expect(promptEnvelope.dynamicPromptMessages).toEqual([]);
  });

  test("summarizes prompt composition stats including thinking and largest tool results", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const shortResult = ["alpha", "beta", "gamma"].join("\n");
    const longResult = `${"z".repeat(220)}\n${"tail".repeat(20)}`;

    session.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "请检查最近几次工具结果为什么这么大。",
        createdAt: "2026-04-26T00:00:00.000Z"
      },
      {
        id: "thinking-1",
        kind: "assistant thinking",
        content: "我先统计一下最近几次 prompt 的组成。",
        signature: "thinking-signature-1",
        createdAt: "2026-04-26T00:00:01.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-read-a",
        toolName: "read_file",
        input: { path: "src/a.ts" },
        state: "completed",
        createdAt: "2026-04-26T00:00:02.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-read-a",
        toolName: "read_file",
        output: shortResult,
        isError: false,
        state: "success",
        createdAt: "2026-04-26T00:00:03.000Z"
      },
      {
        id: "tool-call-2",
        kind: "tool call",
        toolCallId: "call-read-b",
        toolName: "read_file",
        input: { path: "src/b.ts" },
        state: "completed",
        createdAt: "2026-04-26T00:00:04.000Z"
      },
      {
        id: "tool-result-2",
        kind: "tool result",
        toolCallId: "call-read-b",
        toolName: "read_file",
        output: longResult,
        isError: false,
        state: "success",
        createdAt: "2026-04-26T00:00:05.000Z"
      }
    ];

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry(), {
      currentTurnCount: 9,
      maxTurns: 10
    });
    const stats = summarizePromptEnvelopeComposition(promptEnvelope);

    expect(stats.conversationBreakdown.thinkingChars).toBe(
      "我先统计一下最近几次 prompt 的组成。".length
    );
    expect(stats.conversationBreakdown.toolResultCount).toBe(2);
    expect(stats.conversationBreakdown.toolResultChars).toBe(
      shortResult.length + longResult.length
    );
    expect(stats.runtimeContextChars).toBeGreaterThan(0);
    expect(stats.dynamicPromptChars).toBe(
      "Turn budget is nearly exhausted. Consolidate work, avoid exploratory detours, and prefer a final answer or a crisp blocking question."
        .length
    );
    expect(stats.largestToolResults[0]).toMatchObject({
      toolUseId: "call-read-b",
      toolName: "read_file",
      chars: longResult.length,
      isError: false
    });
    expect(stats.largestToolResults[0]?.preview).toContain("zzzz");
  });

  test("adds routine guidance only when routine tools are mounted", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry().register(createCreateRoutineTool());

    const promptEnvelope = promptBuilder.build(session, toolRegistry);

    expect(JSON.stringify(promptEnvelope.prefixMessages[0])).toContain(
      "Mounted tools: create_routine"
    );
    expect(JSON.stringify(promptEnvelope.prefixMessages[0])).toContain(
      "Enabled capability packs: workspace, schedule"
    );
  });

  test("keeps the recent tool chain when compacting a single-user long run", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const blocks: ConversationBlock[] = [
      {
        id: "user-1",
        kind: "user",
        content: "检查 ../ 下的项目文件，告诉我项目中的agent loop是怎么实现的",
        createdAt: "2026-04-24T00:00:00.000Z"
      }
    ];

    for (let index = 0; index < 12; index += 1) {
      blocks.push(
        {
          id: `assistant-${index}`,
          kind: "assistant",
          content: `继续查看第 ${index} 个候选路径`,
          createdAt: "2026-04-24T00:00:00.000Z"
        },
        {
          id: `tool-call-${index}`,
          kind: "tool call",
          toolCallId: `call-${index}`,
          toolName: index === 11 ? "list_directory" : "read_file",
          input:
            index === 11
              ? { path: "../packages/agent/src" }
              : { path: `../missing-${index}.ts` },
          createdAt: "2026-04-24T00:00:00.000Z"
        },
        {
          id: `tool-result-${index}`,
          kind: "tool result",
          toolCallId: `call-${index}`,
          toolName: index === 11 ? "list_directory" : "read_file",
          output:
            index === 11
              ? JSON.stringify({
                  ok: true,
                  data: {
                    path: "../packages/agent/src",
                    entries: [
                      { name: "runtime.ts", kind: "file" },
                      { name: "runtime", kind: "directory" },
                      { name: "tools", kind: "directory" }
                    ]
                  }
                })
              : JSON.stringify({
                  ok: false,
                  message: `ENOENT: ../missing-${index}.ts`
                }),
          isError: index !== 11,
          createdAt: "2026-04-24T00:00:00.000Z"
        }
      );
    }

    session.messages = blocks;

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());
    const serializedMessages = JSON.stringify(promptEnvelope.messages);

    expect(serializedMessages).not.toContain("[History compacted:");
    expect(serializedMessages).toContain("../missing-0.ts");
    expect(serializedMessages).toContain("ENOENT: ../missing-0.ts");
    expect(serializedMessages).not.toContain("[Historical tool call]");
    expect(serializedMessages).not.toContain("[Historical tool result]");
  });

  test("drops standalone historical tool blocks from anthropic messages", () => {
    const session = createSessionSnapshot();
    session.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "检查 agent loop",
        createdAt: "2026-04-24T00:00:00.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "../packages/agent/src/runtime/run-loop.ts" },
        createdAt: "2026-04-24T00:00:01.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "read_file",
        output: "export async function runSessionLoop() {}",
        isError: false,
        createdAt: "2026-04-24T00:00:02.000Z"
      }
    ];

    const promptEnvelope = createPromptBuilder().build(
      session,
      new ToolRegistry()
    );

    expect(JSON.stringify(promptEnvelope.messages)).not.toContain(
      "[Historical tool call]"
    );
    expect(JSON.stringify(promptEnvelope.messages)).not.toContain(
      "[Historical tool result]"
    );
  });

  test("does not serialize compacted historical tool calls as assistant text", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();

    session.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "先看下项目结构",
        createdAt: "2026-04-24T00:00:00.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "list_directory",
        input: { path: ".." },
        state: "completed",
        createdAt: "2026-04-24T00:00:01.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "list_directory",
        output: JSON.stringify({ ok: true }),
        isError: false,
        state: "success",
        createdAt: "2026-04-24T00:00:02.000Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: "我继续往下看。",
        createdAt: "2026-04-24T00:00:03.000Z"
      }
    ];

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());
    const serializedMessages = JSON.stringify(promptEnvelope.messages);

    expect(serializedMessages).not.toContain("[Historical tool call]");
    expect(serializedMessages).not.toContain("[Historical tool result]");
    expect(serializedMessages).toContain("我继续往下看。");
  });

  test("preserves compacted text and thinking while summarizing tool blocks", () => {
    const oldUserText = `Run a long investigation.\n${"u".repeat(700)}`;
    const oldAssistantText = `I checked the first clue.\n${"a".repeat(800)}`;
    const blocks: ConversationBlock[] = [
      {
        id: "user-1",
        kind: "user",
        content: oldUserText,
        createdAt: "2026-04-25T00:00:00.000Z"
      },
      {
        id: "old-thinking",
        kind: "assistant thinking",
        content: "old private reasoning that should not be summarized verbatim",
        signature: "old-signature-should-not-leak",
        createdAt: "2026-04-25T00:00:01.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-secret",
        toolName: "read_file",
        input: { path: "secret.txt" },
        createdAt: "2026-04-25T00:00:01.500Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-secret",
        toolName: "read_file",
        output: "SECRET_TOOL_RESULT_BODY",
        isError: false,
        createdAt: "2026-04-25T00:00:01.750Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: oldAssistantText,
        createdAt: "2026-04-25T00:00:02.000Z"
      }
    ];

    for (let index = 0; index < 18; index += 1) {
      blocks.push({
        id: `tail-assistant-${index}`,
        kind: "assistant",
        content: `tail step ${index}`,
        createdAt: "2026-04-25T00:00:03.000Z"
      });
    }

    const compactedBlocks = compactHistoryBlocks(blocks);
    const serializedMessages = JSON.stringify(
      toAnthropicMessages(compactedBlocks)
    );

    expect(compactedBlocks[0]).toMatchObject({
      id: "user-1",
      kind: "user",
      content: oldUserText
    });
    expect(compactedBlocks[1]).toMatchObject({
      id: "old-thinking",
      kind: "assistant thinking",
      content: "old private reasoning that should not be summarized verbatim",
      signature: "old-signature-should-not-leak"
    });
    expect(compactedBlocks[3]).toMatchObject({
      id: "assistant-1",
      kind: "assistant",
      content: oldAssistantText
    });
    expect(serializedMessages).toContain("[History compacted:");
    expect(serializedMessages).toContain("u".repeat(700));
    expect(serializedMessages).toContain("a".repeat(800));
    expect(serializedMessages).toContain(
      "old private reasoning that should not be summarized verbatim"
    );
    expect(serializedMessages).toContain("old-signature-should-not-leak");
    expect(serializedMessages).not.toContain("SECRET_TOOL_RESULT_BODY");
    expect(serializedMessages).toContain(
      "tool result: read_file succeeded; output omitted from compact summary"
    );
  });

  test("preserves compacted and tail thinking text and signatures", () => {
    const blocks: ConversationBlock[] = [
      {
        id: "user-1",
        kind: "user",
        content: "Run a long investigation.",
        createdAt: "2026-04-25T00:00:00.000Z"
      },
      {
        id: "old-thinking",
        kind: "assistant thinking",
        content: "old private reasoning that should not be summarized verbatim",
        signature: "old-signature-should-not-leak",
        createdAt: "2026-04-25T00:00:01.000Z"
      }
    ];

    for (let index = 0; index < 18; index += 1) {
      blocks.push({
        id: `assistant-${index}`,
        kind: "assistant",
        content: `step ${index} ${"x".repeat(80)}`,
        createdAt: "2026-04-25T00:00:02.000Z"
      });
    }

    blocks.push(
      {
        id: "tail-thinking",
        kind: "assistant thinking",
        content: "tail reasoning must remain protocol-visible",
        signature: "tail-signature-must-remain",
        createdAt: "2026-04-25T00:00:03.000Z"
      },
      {
        id: "tail-tool-call",
        kind: "tool call",
        toolCallId: "call-tail",
        toolName: "read_file",
        input: { path: "src/index.ts" },
        state: "pending",
        createdAt: "2026-04-25T00:00:04.000Z"
      }
    );

    const compactedBlocks = compactHistoryBlocks(blocks);
    const serializedMessages = JSON.stringify(
      toAnthropicMessages(compactedBlocks)
    );

    expect(serializedMessages).not.toContain("[History compacted:");
    expect(serializedMessages).toContain(
      "old private reasoning that should not be summarized verbatim"
    );
    expect(serializedMessages).toContain("old-signature-should-not-leak");
    expect(serializedMessages).toContain(
      "tail reasoning must remain protocol-visible"
    );
    expect(serializedMessages).toContain("tail-signature-must-remain");
  });

  test("injects full compaction continuation summary into runtime context messages without changing the cache key", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const base = promptBuilder.build(session, new ToolRegistry());

    session.context.fullCompactionState = {
      summaryMarkdown: [
        "## Goal",
        "Keep implementing the runtime compaction flow.",
        "",
        "## Constraints",
        "- Avoid leaking tool result bodies."
      ].join("\n"),
      compactedAt: "2026-04-26T10:00:00.000Z",
      promptVersion: "full-compaction-v1",
      sourceBlockCount: 12,
      retainedTailCount: 6
    };

    const withSummary = promptBuilder.build(session, new ToolRegistry());

    expect(withSummary.runtimeContextMessages).toHaveLength(3);
    expect(JSON.stringify(withSummary.runtimeContextMessages[1])).toContain(
      "Continuation summary from the latest full compaction"
    );
    expect(JSON.stringify(withSummary.runtimeContextMessages[1])).toContain(
      "Keep implementing the runtime compaction flow."
    );
    expect(withSummary.cacheKey).toBe(base.cacheKey);
  });
});
