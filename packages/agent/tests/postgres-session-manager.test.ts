import { describe, expect, test } from "bun:test";

import {
  hasActiveExecutionLease,
  serializeBlock,
  toSessionContext,
  toConversationBlock,
  toIsoString,
  type SessionMessageRow
} from "../src/session/postgres-session-manager.js";
import { isConversationBlock } from "../src/session/shared.js";
import { DEFAULT_EXECUTION_LEASE_TIMEOUT_MS } from "../src/session/contracts.js";

describe("toIsoString", () => {
  test("preserves timestamps that already include a timezone", () => {
    expect(toIsoString("2026-04-21T18:45:18.392Z")).toBe(
      "2026-04-21T18:45:18.392Z"
    );
  });

  test("treats SQL timestamps without timezone as UTC", () => {
    expect(toIsoString("2026-04-21 18:45:18.392")).toBe(
      "2026-04-21T18:45:18.392Z"
    );
  });

  test("serializes and restores assistant thinking blocks", () => {
    const serialized = serializeBlock({
      id: "thinking-1",
      kind: "assistant thinking",
      content: "I should call a tool before answering.",
      signature: "thinking-signature-1",
      createdAt: "2026-04-25T00:00:00.000Z"
    });

    expect(serialized).toMatchObject({
      role: "assistant_thinking",
      content: "I should call a tool before answering.",
      inputJson: { signature: "thinking-signature-1" }
    });

    const row: SessionMessageRow = {
      id: "thinking-1",
      sessionId: "session-1",
      messageIndex: 1,
      role: serialized.role,
      content: serialized.content,
      toolName: serialized.toolName,
      toolCallId: serialized.toolCallId,
      state: serialized.state,
      isError: serialized.isError,
      inputJson: serialized.inputJson,
      outputText: serialized.outputText,
      createdAt: serialized.createdAt
    };

    expect(toConversationBlock(row)).toEqual({
      id: "thinking-1",
      kind: "assistant thinking",
      content: "I should call a tool before answering.",
      signature: "thinking-signature-1",
      createdAt: "2026-04-25T00:00:00.000Z"
    });
  });

  test("accepts assistant thinking blocks in session snapshots", () => {
    expect(
      isConversationBlock({
        id: "thinking-1",
        kind: "assistant thinking",
        content: "reasoning",
        signature: "signature-1",
        createdAt: "2026-04-25T00:00:00.000Z"
      })
    ).toBe(true);
  });

  test("serializes and restores tool result details", () => {
    const serialized = serializeBlock({
      id: "tool-result-1",
      kind: "tool result",
      toolCallId: "call-1",
      toolName: "edit_file",
      output: '{"ok":true}',
      isError: false,
      state: "success",
      details: {
        kind: "workspace_file_changes",
        files: [
          {
            path: "apps/web/app/page.tsx",
            action: "modify",
            addedLineCount: 2,
            removedLineCount: 1,
            diff: "--- apps/web/app/page.tsx\n+++ apps/web/app/page.tsx"
          }
        ]
      },
      createdAt: "2026-04-26T00:00:00.000Z"
    });

    expect(serialized.inputJson).toEqual({
      details: {
        kind: "workspace_file_changes",
        files: [
          {
            path: "apps/web/app/page.tsx",
            action: "modify",
            addedLineCount: 2,
            removedLineCount: 1,
            diff: "--- apps/web/app/page.tsx\n+++ apps/web/app/page.tsx"
          }
        ]
      }
    });

    const row: SessionMessageRow = {
      id: "tool-result-1",
      sessionId: "session-1",
      messageIndex: 2,
      role: serialized.role,
      content: serialized.content,
      toolName: serialized.toolName,
      toolCallId: serialized.toolCallId,
      state: serialized.state,
      isError: serialized.isError,
      inputJson: serialized.inputJson,
      outputText: serialized.outputText,
      createdAt: serialized.createdAt
    };

    expect(toConversationBlock(row)).toEqual({
      id: "tool-result-1",
      kind: "tool result",
      toolCallId: "call-1",
      toolName: "edit_file",
      output: '{"ok":true}',
      isError: false,
      state: "success",
      details: {
        kind: "workspace_file_changes",
        files: [
          {
            path: "apps/web/app/page.tsx",
            action: "modify",
            addedLineCount: 2,
            removedLineCount: 1,
            diff: "--- apps/web/app/page.tsx\n+++ apps/web/app/page.tsx"
          }
        ]
      },
      createdAt: "2026-04-26T00:00:00.000Z"
    });
  });

  test("restores workspace escape approval from postgres rows", () => {
    const sessionContext = toSessionContext({
      id: "session-1",
      userId: "user-1",
      status: "waiting_for_permission",
      currentDateContext: "2026-04-26",
      yoloMode: false,
      workspaceEscapeAllowed: true,
      contextWindow: 200000,
      maxTurns: 50,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: ["workspace", "schedule"],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      todoState: {
        items: [
          {
            id: "todo-1",
            content: "Inspect runtime prompt boundaries",
            status: "in_progress",
            createdAt: "2026-04-26T00:00:00.000Z",
            updatedAt: "2026-04-26T00:00:00.000Z"
          }
        ],
        activeItemId: "todo-1",
        lastUpdatedAt: "2026-04-26T00:00:00.000Z"
      },
      fullCompactionState: {
        summaryMarkdown: "## Goal\nContinue the task.",
        compactedAt: "2026-04-26T00:00:00.000Z",
        promptVersion: "full-compaction-v1",
        sourceBlockCount: 12,
        retainedTailCount: 6
      },
      pendingConflictSummary: null,
      firstUserMessage: null,
      lastUserMessage: null,
      workingDirectory: "/tmp/workspace",
      model: "MiniMax-M2.7",
      loopState: "waiting for tool result",
      turnCount: 1,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false,
      historyCompactionsSinceFullCompaction: 1,
      inputTokensCount: 0,
      promptCacheKey: "",
      activeRunId: null,
      activeRunStartedAt: null,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z"
    });

    expect(sessionContext.workspaceEscapeAllowed).toBe(true);
    expect(sessionContext.todoState?.activeItemId).toBe("todo-1");
    expect(sessionContext.fullCompactionState?.promptVersion).toBe(
      "full-compaction-v1"
    );
  });
});

describe("hasActiveExecutionLease", () => {
  test("treats a recent execution lease as active", () => {
    expect(
      hasActiveExecutionLease({
        activeRunId: "run-1",
        activeRunStartedAt: "2026-04-30T00:00:00.000Z",
        now: Date.parse("2026-04-30T00:10:00.000Z")
      })
    ).toBe(true);
  });

  test("treats a stale execution lease as inactive", () => {
    expect(
      hasActiveExecutionLease({
        activeRunId: "run-1",
        activeRunStartedAt: "2026-04-30T00:00:00.000Z",
        now:
          Date.parse("2026-04-30T00:00:00.000Z") +
          DEFAULT_EXECUTION_LEASE_TIMEOUT_MS +
          1
      })
    ).toBe(false);
  });

  test("does not keep a missing start timestamp active forever", () => {
    expect(
      hasActiveExecutionLease({
        activeRunId: "run-1",
        activeRunStartedAt: null
      })
    ).toBe(false);
  });
});
