import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildMemoryBody,
  createMemorySearchTool,
  enqueueIdleMemorySummaries,
  formatMemoryDocument
} from "../src/index.js";
import type { BackgroundTaskRecord } from "@ai-app-template/domain";
import type { BackgroundTaskManager } from "../src/background-tasks/contracts.js";
import type { SessionManager } from "../src/session/contracts.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";
import type { SessionSnapshot } from "../src/types.js";

function createContext(workingDirectory: string): ToolExecutionContext {
  return {
    sessionId: "session-1",
    workingDirectory,
    routineRepository: undefined as never,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-05-06",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
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

function createSession(input: {
  sessionId: string;
  workingDirectory: string;
  updatedAt: string;
  messageCount?: number;
  activeBackgroundTaskCount?: number;
}): SessionSnapshot {
  return {
    sessionId: input.sessionId,
    cronJobId: null,
    parentSessionId: null,
    parentRelationKind: null,
    forkReplayCheckpointId: null,
    workingDirectory: input.workingDirectory,
    model: "gpt-test",
    contextWindow: 128_000,
    maxTurns: 20,
    context: {
      status: "waiting_for_user_input",
      currentDateContext: "2026-05-06",
      yoloMode: false,
      planModeEnabled: false,
      thinkingEffort: "medium",
      taskBriefPath: null,
      firstUserMessage: "implement memory",
      lastUserMessage: "implement memory",
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: ["workspace"],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingBackgroundNotifications: [],
      hookContextEntries: [],
      todoState: null,
      activeBackgroundTaskCount: input.activeBackgroundTaskCount ?? 0,
      fullCompactionState: null
    },
    messages: Array.from({ length: input.messageCount ?? 1 }, (_, index) => ({
      id: `user-${index}`,
      kind: "user" as const,
      content: "implement memory search",
      createdAt: input.updatedAt
    })),
    sessionState: {
      loopState: "waiting for input",
      turnCount: 1,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false,
      historyCompactionsSinceFullCompaction: 0
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: input.updatedAt
  };
}

describe("memory tools", () => {
  test("memory_search ranks metadata and returns concise conclusions", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "memory-workspace-"));
    const memoryDir = await mkdtemp(path.join(tmpdir(), "memories-"));

    try {
      await mkdir(memoryDir, { recursive: true });
      await writeFile(
        path.join(memoryDir, "2026-05-06-memory-runtime.md"),
        formatMemoryDocument({
          metadata: {
            name: "memory runtime design",
            description: "Implement memory_search using file metadata.",
            cwd: workspace,
            keywords: ["memory_search", "background_tasks"],
            created_at: "2026-05-06T00:00:00.000Z",
            updated_at: "2026-05-06T00:00:00.000Z",
            last_verified_at: "2026-05-06T00:00:00.000Z",
            confidence: 0.8,
            touched_paths: ["packages/agent/src/tools/memory-search.ts"],
            evidence_refs: ["session:abc"],
            source_session_id: "abc"
          },
          body: buildMemoryBody({
            background: "Need a synchronous memory search tool.",
            reusableConclusion:
              "Register memory_search in the workspace tool pack and scan metadata only by default.",
            evidence: "session:abc",
            steps: "Check the current registry before relying on this memory."
          })
        }),
        "utf8"
      );

      const result = await createMemorySearchTool({
        memoryDirectory: memoryDir
      }).execute(
        {
          query: "memory_search registry",
          cwd: workspace,
          paths: ["packages/agent/src/tools/memory-search.ts"],
          limit: 3
        },
        createContext(workspace)
      );

      expect(result.state).toBe("success");
      expect(result.result.data).toMatchObject({
        returnedCount: 1,
        matches: [
          {
            metadata: {
              name: "memory runtime design",
              source_session_id: "abc"
            },
            reusableConclusion:
              "Register memory_search in the workspace tool pack and scan metadata only by default.",
            evidenceRefs: ["session:abc"]
          }
        ]
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(memoryDir, { recursive: true, force: true });
    }
  });

  test("idle scheduler enqueues one memory_summary task per session stage", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "memory-idle-"));
    const session = createSession({
      sessionId: "session-1",
      workingDirectory: workspace,
      updatedAt: "2026-05-06T00:00:00.000Z",
      messageCount: 2
    });
    const tasks: BackgroundTaskRecord[] = [];
    const sessionManager = {
      listSessions: async () => [session],
      isExecutionActive: async () => false
    } as Pick<
      SessionManager,
      "listSessions" | "isExecutionActive"
    > as SessionManager;
    const taskManager = {
      enqueueTask: async (input) => {
        const task = {
          taskId: `task-${tasks.length + 1}`,
          kind: input.kind,
          status: "queued",
          executor: input.executor ?? "agent_session",
          parentSessionId: input.parentSessionId ?? null,
          childSessionId: input.childSessionId ?? null,
          payload: {
            executor: "memory_summary",
            message: input.message,
            workingDirectory: input.workingDirectory,
            model: input.model,
            maxTurns: input.maxTurns ?? 1,
            enabledCapabilityPacks: input.enabledCapabilityPacks ?? [],
            metadata: input.metadata ?? {},
            sourceSessionId: input.sourceSessionId ?? "",
            stageKey: input.stageKey ?? "",
            memoryDirectory: input.memoryDirectory ?? null
          },
          taskState: input.taskState ?? null,
          resultSummary: null,
          lastError: null,
          availableAt: null,
          deadlineAt: null,
          attemptCount: 0,
          maxAttempts: 1,
          cancelRequested: false,
          activeRunId: null,
          claimedBy: null,
          claimedAt: null,
          lastHeartbeatAt: null,
          completedAt: null,
          createdAt: "2026-05-06T00:10:01.000Z",
          updatedAt: "2026-05-06T00:10:01.000Z"
        } satisfies BackgroundTaskRecord;
        tasks.push(task);
        return task;
      }
    } as Pick<BackgroundTaskManager, "enqueueTask"> as BackgroundTaskManager;

    try {
      const first = await enqueueIdleMemorySummaries({
        sessionManager,
        taskManager,
        listTasks: async () => tasks,
        isMemoryEnabled: async () => true,
        now: new Date("2026-05-06T00:10:01.000Z").getTime(),
        idleMs: 10 * 60_000,
        memoryDirectory: path.join(workspace, "memories")
      });
      const second = await enqueueIdleMemorySummaries({
        sessionManager,
        taskManager,
        listTasks: async () => tasks,
        isMemoryEnabled: async () => true,
        now: new Date("2026-05-06T00:20:01.000Z").getTime(),
        idleMs: 10 * 60_000,
        memoryDirectory: path.join(workspace, "memories")
      });

      expect(first.enqueuedTaskIds).toEqual(["task-1"]);
      expect(second.enqueuedTaskIds).toEqual([]);
      expect(tasks[0]?.payload).toMatchObject({
        executor: "memory_summary",
        sourceSessionId: "session-1"
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("idle scheduler does not enqueue memory summaries unless settings enable it", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "memory-disabled-"));
    const session = createSession({
      sessionId: "session-1",
      workingDirectory: workspace,
      updatedAt: "2026-05-06T00:00:00.000Z",
      messageCount: 2
    });
    const sessionManager = {
      listSessions: async () => [session],
      isExecutionActive: async () => false
    } as Pick<
      SessionManager,
      "listSessions" | "isExecutionActive"
    > as SessionManager;
    const taskManager = {
      enqueueTask: async () => {
        throw new Error("enqueueTask should not run");
      }
    } as Pick<BackgroundTaskManager, "enqueueTask"> as BackgroundTaskManager;

    try {
      const result = await enqueueIdleMemorySummaries({
        sessionManager,
        taskManager,
        listTasks: async () => [],
        isMemoryEnabled: async () => false,
        now: new Date("2026-05-06T00:10:01.000Z").getTime(),
        idleMs: 10 * 60_000
      });

      expect(result.enqueuedTaskIds).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
