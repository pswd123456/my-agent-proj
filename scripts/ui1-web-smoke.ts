import assert from "node:assert/strict";

import {
  buildWeekRange,
  collectToolRows,
  flattenTraceRecords,
  groupRoutinesByDate,
  mergeSessionSummary
} from "../apps/web/app/_components/ui1-workbench-state.ts";
import { toSessionSummary, type SessionSnapshot } from "../packages/sdk/src/index.ts";

const baseSession = {
  sessionId: "session-a",
  workingDirectory: process.cwd(),
  model: "MiniMax-M2.7",
  context: {
    userId: "web-user",
    status: "running",
    currentDateContext: "2026-04-21",
    pendingPermissionRequest: null,
    pendingConfirmationPayload: null,
    pendingConflictSummary: null,
    lastUserMessage: "old"
  },
  messages: [],
  sessionState: {
    loopState: "running",
    turnCount: 1,
    lastError: null,
    pendingToolCallIds: []
  },
  inputTokensCount: 12,
  promptCacheKey: "cache-a",
  updatedAt: "2026-04-21T10:00:00.000Z"
} satisfies SessionSnapshot;

const merged = mergeSessionSummary(
  [toSessionSummary(baseSession)],
  {
    ...baseSession,
    updatedAt: "2026-04-21T12:00:00.000Z",
    context: {
      ...baseSession.context,
      lastUserMessage: "latest"
    }
  },
  toSessionSummary
);
assert.equal(merged.length, 1);
assert.equal(merged[0]?.lastUserMessage, "latest");

const flattened = flattenTraceRecords([
  {
    sessionId: "session-a",
    createdAt: "2026-04-21T10:00:00.000Z",
    event: {
      kind: "prompt",
      turnCount: 1,
      system: "system",
      prefixMessages: [],
      messages: [],
      tools: [],
      toolChoice: null,
      cacheKey: "cache-a"
    }
  }
]);
assert.equal(flattened[0]?.kind, "prompt");

const toolRows = collectToolRows([
  {
    kind: "tool_call",
    sessionId: "session-a",
    createdAt: "2026-04-21T10:01:00.000Z",
    turnCount: 1,
    toolCallId: "call-1",
    toolName: "create_routine",
    input: { name: "meeting" }
  },
  {
    kind: "tool_result",
    sessionId: "session-a",
    createdAt: "2026-04-21T10:01:10.000Z",
    turnCount: 1,
    toolCallId: "call-1",
    toolName: "create_routine",
    output: "{\"ok\":true}",
    displayText: "[create_routine] success",
    isError: false
  }
]);
assert.equal(toolRows[0]?.displayText, "[create_routine] success");

const grouped = groupRoutinesByDate([
  {
    id: "routine-1",
    userId: "web-user",
    name: "meeting",
    description: null,
    date: "2026-04-21",
    startTime: "10:00",
    endTime: "11:00",
    durationMinutes: 60,
    startAt: "2026-04-21 10:00:00",
    endAt: "2026-04-21 11:00:00",
    status: "active",
    source: "user_confirmed",
    createdAt: "2026-04-21T10:00:00.000Z",
    updatedAt: "2026-04-21T10:00:00.000Z"
  }
]);
assert.equal(grouped.get("2026-04-21")?.length, 1);

const week = buildWeekRange("2026-04-21");
assert.equal(week.dates.length, 7);
assert.equal(week.startDate, "2026-04-20");

console.log(
  JSON.stringify(
    {
      ok: true,
      week,
      toolRows: toolRows.length
    },
    null,
    2
  )
);
