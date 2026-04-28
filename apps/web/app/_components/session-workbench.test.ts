import { describe, expect, test } from "bun:test";

import type { RunStreamEvent } from "@ai-app-template/sdk";

import {
  buildRunFileChangesState,
  collectWorkspaceFileChangesFromRun,
  getRunFileChangesAggregateState,
  getSelectedWorkspaceFileChanges
} from "./session-workbench";

const runCompleteWithFileChanges: Extract<
  RunStreamEvent,
  { kind: "run_complete" }
> = {
  kind: "run_complete",
  sessionId: "session-1",
  createdAt: "2026-04-28T10:00:00.000Z",
  finalAnswer: "done",
  status: "completed",
  stopReason: "end_turn",
  toolCallCount: 2,
  toolResultCount: 2,
  toolOutputs: [
    {
      toolCallId: "tool-1",
      toolName: "edit_file",
      content: "ok",
      displayText: "updated",
      isError: false,
      details: {
        kind: "workspace_file_changes",
        files: [
          {
            path: "apps/web/app/page.tsx",
            action: "modify",
            addedLineCount: 3,
            removedLineCount: 2,
            diff: "--- a/apps/web/app/page.tsx\n+++ b/apps/web/app/page.tsx"
          }
        ]
      }
    },
    {
      toolCallId: "tool-2",
      toolName: "write_file",
      content: "ok",
      displayText: "wrote",
      isError: false,
      details: {
        kind: "workspace_file_changes",
        files: [
          {
            path: "apps/web/app/layout.tsx",
            action: "create",
            addedLineCount: 2,
            removedLineCount: 0,
            diff: "--- /dev/null\n+++ b/apps/web/app/layout.tsx"
          }
        ]
      }
    },
    {
      toolCallId: "tool-3",
      toolName: "read_file",
      content: "content",
      displayText: "read",
      isError: false
    }
  ],
  session: {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200000,
    maxTurns: 50,
    context: {
      userId: "user-1",
      status: "waiting_for_user_input",
      currentDateContext: "2026-04-28",
      yoloMode: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingConflictSummary: null,
      firstUserMessage: null,
      lastUserMessage: null
    },
    messages: [],
    sessionState: {
      loopState: "completed",
      turnCount: 1,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false,
      historyCompactionsSinceFullCompaction: 0
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: "2026-04-28T10:00:00.000Z"
  }
};

describe("session-workbench run file changes", () => {
  test("collects only successful workspace file changes from run output", () => {
    expect(
      collectWorkspaceFileChangesFromRun(runCompleteWithFileChanges)
    ).toHaveLength(2);
  });

  test("builds an applied run file change view after a run completes", () => {
    expect(buildRunFileChangesState(runCompleteWithFileChanges)).toMatchObject({
      key: "run-file-changes:2026-04-28T10:00:00.000Z",
      state: "applied",
      pendingAction: null,
      errorText: null,
      selectedFileIndexes: [0, 1],
      fileStates: ["applied", "applied"],
      files: [
        expect.objectContaining({
          path: "apps/web/app/page.tsx",
          addedLineCount: 3,
          removedLineCount: 2
        }),
        expect.objectContaining({
          path: "apps/web/app/layout.tsx",
          addedLineCount: 2,
          removedLineCount: 0
        })
      ]
    });
  });

  test("selects a subset of run file changes for follow-up actions", () => {
    const view = buildRunFileChangesState(runCompleteWithFileChanges);

    expect(
      view
        ? getSelectedWorkspaceFileChanges({
            ...view,
            selectedFileIndexes: [1]
          }).map((file) => file.path)
        : []
    ).toEqual(["apps/web/app/layout.tsx"]);
  });

  test("summarizes mixed applied and undone file states", () => {
    expect(getRunFileChangesAggregateState(["applied", "undone"])).toBe(
      "mixed"
    );
    expect(getRunFileChangesAggregateState(["undone", "undone"])).toBe(
      "undone"
    );
  });
});
