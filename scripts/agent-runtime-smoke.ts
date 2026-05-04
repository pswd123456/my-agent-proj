import assert from "node:assert/strict";

import {
  createAgentRuntime,
  createScheduleToolRegistry,
  createPromptBuilder,
  type AnthropicCompatibleClient,
  SessionExecutionInProgressError,
  type RunStreamEvent
} from "../packages/agent/src/index.ts";
import { createMemoryRoutineRepository } from "../packages/db/src/index.ts";
import { handlePendingConfirmationReply } from "../packages/agent/src/runtime/confirmation.ts";
import { createScriptPostgresSessionManager } from "./postgres-session.ts";

const routineRepository = createMemoryRoutineRepository();
const { sessionManager } = await createScriptPostgresSessionManager();
const emittedEvents: RunStreamEvent[] = [];
let callCount = 0;

const fakeClient: AnthropicCompatibleClient = {
  messages: {
    async create() {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: [
            {
              type: "thinking",
              thinking: "Inspecting the request before choosing a tool.",
              signature: "sig-1"
            },
            {
              type: "text",
              text: "I am checking your schedule."
            },
            {
              type: "tool_use",
              id: "create-1",
              name: "manage_routine",
              input: {
                action: "create",
                name: "meeting",
                date: "2026-04-21",
                start_time: "10:00",
                end_time: "11:00",
                source: "user_confirmed"
              }
            }
          ]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: "Created your routine."
          }
        ]
      };
    }
  }
};

const runtime = createAgentRuntime({
  client: fakeClient,
  model: "MiniMax-M2.7",
  sessionManager,
  routineRepository,
  toolRegistry: createScheduleToolRegistry(),
  promptBuilder: createPromptBuilder(),
  maxTurns: 4,
  maxTokens: 128
});

const session = await runtime.createSession({
  workingDirectory: process.cwd(),
  model: "MiniMax-M2.7",
  userId: "runtime-smoke"
});

const result = await runtime.run({
  sessionId: session.sessionId,
  message: "Please add a meeting tomorrow at 10.",
  eventSink(event) {
    emittedEvents.push(event);
  }
});

const eventKinds = emittedEvents.map((event) => event.kind);
assert.deepEqual(eventKinds, [
  "skills_loaded",
  "context_hooks_loaded",
  "workspace_instructions_loaded",
  "turn_start",
  "prompt",
  "response",
  "thinking",
  "assistant_text",
  "tool_call",
  "tool_result",
  "turn_end",
  "skills_loaded",
  "context_hooks_loaded",
  "workspace_instructions_loaded",
  "turn_start",
  "prompt",
  "response",
  "assistant_text",
  "turn_end",
  "run_complete"
]);

assert.equal(result.finalAnswer, "Created your routine.");
assert.equal(
  result.session.messages.filter(
    (block) =>
      block.kind === "assistant" && block.content === "Created your routine."
  ).length,
  1
);
assert.equal(
  result.session.messages.some(
    (block) =>
      block.kind === "assistant" &&
      block.content.includes("Inspecting the request")
  ),
  false
);

const disconnectedSession = await runtime.createSession({
  workingDirectory: process.cwd(),
  model: "MiniMax-M2.7",
  userId: "runtime-smoke"
});

const disconnectedResult = await runtime.run({
  sessionId: disconnectedSession.sessionId,
  message: "This should still complete even if the stream closes.",
  eventSink() {
    throw new Error("sink failed");
  }
});

assert.equal(disconnectedResult.status, "completed");
assert.equal(disconnectedResult.finalAnswer, "Created your routine.");
assert.equal(disconnectedResult.session.sessionState.loopState, "completed");
assert.equal(disconnectedResult.session.sessionState.lastError, null);

let releaseBusyRun: (() => void) | null = null;
const busyClient: AnthropicCompatibleClient = {
  messages: {
    async create() {
      await new Promise<void>((resolve) => {
        releaseBusyRun = resolve;
      });
      return {
        content: [{ type: "text", text: "Busy run completed." }]
      };
    }
  }
};

const busyRoutineRepository = createMemoryRoutineRepository();

const busyRuntime = createAgentRuntime({
  client: busyClient,
  model: "MiniMax-M2.7",
  sessionManager,
  routineRepository: busyRoutineRepository,
  toolRegistry: createScheduleToolRegistry(),
  promptBuilder: createPromptBuilder(),
  maxTurns: 2
});

const busySession = await busyRuntime.createSession({
  workingDirectory: process.cwd(),
  model: "MiniMax-M2.7",
  userId: "runtime-smoke"
});

const runningPromise = busyRuntime.run({
  sessionId: busySession.sessionId,
  message: "Hold this run open."
});

for (let attempts = 0; attempts < 20 && !releaseBusyRun; attempts += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(releaseBusyRun);

await assert.rejects(
  () =>
    busyRuntime.run({
      sessionId: busySession.sessionId,
      message: "This should be rejected."
    }),
  (error) => error instanceof SessionExecutionInProgressError
);

releaseBusyRun?.();
const busyResult = await runningPromise;
assert.equal(busyResult.finalAnswer, "Busy run completed.");

const confirmationRoutineRepository = createMemoryRoutineRepository();
const confirmationSessionManager = sessionManager;
const confirmationSession = await confirmationSessionManager.createSession({
  workingDirectory: process.cwd(),
  model: "MiniMax-M2.7",
  userId: "runtime-smoke"
});
const confirmationToolRegistry = createScheduleToolRegistry();

await confirmationSessionManager.updateContext(confirmationSession.sessionId, {
  pendingConfirmationPayload: {
    summaryText: "Need confirmation.",
    proposedItems: [
      {
        previewText: "2026-04-21 10:00-11:00 confirmation item",
        toolName: "manage_routine",
        toolInput: {
          action: "create",
          name: "confirmation item",
          date: "2026-04-21",
          start_time: "10:00",
          end_time: "11:00",
          source: "agent_suggested_confirmed"
        }
      }
    ],
    conflictItems: []
  }
});

let pendingConfirmationSession = await confirmationSessionManager.getSession(
  confirmationSession.sessionId
);
assert.ok(pendingConfirmationSession);

await handlePendingConfirmationReply({
  sessionManager: confirmationSessionManager,
  routineRepository: confirmationRoutineRepository,
  toolRegistry: confirmationToolRegistry,
  traceManager: undefined,
  session: pendingConfirmationSession,
  message: "确认",
  pendingConfirmation:
    pendingConfirmationSession.context.pendingConfirmationPayload!,
  eventSink: undefined
});

await confirmationSessionManager.updateContext(confirmationSession.sessionId, {
  pendingConfirmationPayload: {
    summaryText: "Need confirmation again.",
    proposedItems: [
      {
        previewText: "2026-04-21 14:00-15:00 confirmation item 2",
        toolName: "manage_routine",
        toolInput: {
          action: "create",
          name: "confirmation item 2",
          date: "2026-04-21",
          start_time: "14:00",
          end_time: "15:00",
          source: "agent_suggested_confirmed"
        }
      }
    ],
    conflictItems: []
  }
});

pendingConfirmationSession = await confirmationSessionManager.getSession(
  confirmationSession.sessionId
);
assert.ok(pendingConfirmationSession);

await handlePendingConfirmationReply({
  sessionManager: confirmationSessionManager,
  routineRepository: confirmationRoutineRepository,
  toolRegistry: confirmationToolRegistry,
  traceManager: undefined,
  session: pendingConfirmationSession,
  message: "确认",
  pendingConfirmation:
    pendingConfirmationSession.context.pendingConfirmationPayload!,
  eventSink: undefined
});

const confirmedSession = await confirmationSessionManager.getSession(
  confirmationSession.sessionId
);
assert.ok(confirmedSession);

const confirmationToolCallIds = confirmedSession.messages
  .filter((block) => block.kind === "tool call")
  .map((block) => block.toolCallId);
assert.equal(confirmationToolCallIds.length, 2);
assert.equal(
  new Set(confirmationToolCallIds).size,
  confirmationToolCallIds.length
);

console.log(
  JSON.stringify(
    {
      ok: true,
      eventKinds
    },
    null,
    2
  )
);
