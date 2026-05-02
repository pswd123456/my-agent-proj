import { describe, expect, test } from "bun:test";

import type { RunStreamEvent } from "@ai-app-template/sdk";

import {
  buildRunFileChangesState,
  buildRunFileChangesStatesFromSession,
  collectWorkspaceFileChangesFromRun,
  getRunFileChangesAggregateState,
  getSelectedWorkspaceFileChanges,
  mergeRunFileChangesStates,
  shouldBootstrapFromRequestedSession,
  shouldLoadExtendedSettingsForPanel,
  shouldApplySelectedSessionResponse,
  shouldApplySessionListResponse
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
      toolName: "apply_patch",
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
      createdAt: "2026-04-28T10:00:00.000Z",
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

  test("rebuilds one file change view for each persisted user run", () => {
    const views = buildRunFileChangesStatesFromSession({
      ...runCompleteWithFileChanges.session,
      messages: [
        {
          id: "user-1",
          kind: "user",
          content: "改页面",
          createdAt: "2026-04-28T09:59:00.000Z"
        },
        {
          id: "tool-result-1",
          kind: "tool result",
          toolCallId: "tool-1",
          toolName: "apply_patch",
          output: "ok",
          isError: false,
          state: "success",
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
          },
          createdAt: "2026-04-28T10:00:00.000Z"
        },
        {
          id: "user-2",
          kind: "user",
          content: "再改布局",
          createdAt: "2026-04-28T10:01:00.000Z"
        },
        {
          id: "tool-result-2",
          kind: "tool result",
          toolCallId: "tool-2",
          toolName: "write_file",
          output: "ok",
          isError: false,
          state: "success",
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
          },
          createdAt: "2026-04-28T10:02:00.000Z"
        }
      ]
    });

    expect(views.map((view) => view.key)).toEqual([
      "run-file-changes:session-1:user-1",
      "run-file-changes:session-1:user-2"
    ]);
    expect(views.map((view) => view.files.map((file) => file.path))).toEqual([
      ["apps/web/app/page.tsx"],
      ["apps/web/app/layout.tsx"]
    ]);
  });

  test("keeps local undo state when persisted run views refresh", () => {
    const next = buildRunFileChangesStatesFromSession({
      ...runCompleteWithFileChanges.session,
      messages: [
        {
          id: "user-1",
          kind: "user",
          content: "改页面",
          createdAt: "2026-04-28T09:59:00.000Z"
        },
        {
          id: "tool-result-1",
          kind: "tool result",
          toolCallId: "tool-1",
          toolName: "apply_patch",
          output: "ok",
          isError: false,
          state: "success",
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
          },
          createdAt: "2026-04-28T10:00:00.000Z"
        }
      ]
    });

    const merged = mergeRunFileChangesStates(
      [
        {
          ...next[0]!,
          fileStates: ["undone"],
          state: "undone",
          selectedFileIndexes: [],
          errorText: "stale"
        }
      ],
      next
    );

    expect(merged[0]).toMatchObject({
      fileStates: ["undone"],
      state: "undone",
      selectedFileIndexes: [],
      errorText: "stale"
    });
  });
});

describe("session-workbench session list response guard", () => {
  test("accepts the latest settled session list response", () => {
    expect(
      shouldApplySessionListResponse({
        requestVersion: 4,
        currentVersion: 4,
        mutationInFlight: false
      })
    ).toBe(true);
  });

  test("rejects a stale response after the session list version changes", () => {
    expect(
      shouldApplySessionListResponse({
        requestVersion: 4,
        currentVersion: 5,
        mutationInFlight: false
      })
    ).toBe(false);
  });

  test("rejects responses while a destructive session mutation is in flight", () => {
    expect(
      shouldApplySessionListResponse({
        requestVersion: 4,
        currentVersion: 4,
        mutationInFlight: true
      })
    ).toBe(false);
  });
});

describe("session-workbench selected session response guard", () => {
  test("accepts the latest selected session response when no mutation is active", () => {
    expect(
      shouldApplySelectedSessionResponse({
        expectedSessionId: "session-1",
        currentSessionId: "session-1",
        mutationInFlight: false
      })
    ).toBe(true);
  });

  test("rejects a stale selected session response after selection changes", () => {
    expect(
      shouldApplySelectedSessionResponse({
        expectedSessionId: "session-1",
        currentSessionId: "session-2",
        mutationInFlight: false
      })
    ).toBe(false);
  });

  test("rejects selected session responses while a destructive mutation is in flight", () => {
    expect(
      shouldApplySelectedSessionResponse({
        expectedSessionId: "session-1",
        currentSessionId: "session-1",
        mutationInFlight: true
      })
    ).toBe(false);
  });
});

describe("session-workbench route bootstrap guard", () => {
  test("boots on first load before any sessions are hydrated", () => {
    expect(
      shouldBootstrapFromRequestedSession({
        hasHydratedSessions: false,
        requestedSessionId: "session-2",
        selectedSessionId: "session-1"
      })
    ).toBe(true);
  });

  test("skips redundant bootstrap after internal session URL sync", () => {
    expect(
      shouldBootstrapFromRequestedSession({
        hasHydratedSessions: true,
        requestedSessionId: "session-2",
        selectedSessionId: "session-2"
      })
    ).toBe(false);
  });

  test("reconciles when the requested session changes externally", () => {
    expect(
      shouldBootstrapFromRequestedSession({
        hasHydratedSessions: true,
        requestedSessionId: "session-3",
        selectedSessionId: "session-2"
      })
    ).toBe(true);
  });
});

describe("session-workbench extended settings loading", () => {
  test("loads extended settings only in settings mode", () => {
    expect(shouldLoadExtendedSettingsForPanel("settings")).toBe(true);
    expect(shouldLoadExtendedSettingsForPanel("calendar")).toBe(false);
    expect(shouldLoadExtendedSettingsForPanel("inspector")).toBe(false);
    expect(shouldLoadExtendedSettingsForPanel(null)).toBe(false);
  });
});
