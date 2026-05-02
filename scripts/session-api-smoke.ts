import assert from "node:assert/strict";
import path from "node:path";

import { DEFAULT_SESSION_WORKING_DIRECTORY } from "../packages/domain/src/index.ts";
import {
  createAgentRuntime,
  createScheduleToolRegistry,
  createFileTraceManager,
  createPromptBuilder,
  resolveSessionStateDirectory,
  type AnthropicCompatibleClient,
  type SessionSnapshot
} from "../packages/agent/src/index.ts";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "../packages/db/src/index.ts";
import { createApiApp } from "../apps/api/src/app.ts";
import { createScriptPostgresSessionManager } from "./postgres-session.ts";

async function readSse(response: Response) {
  const body = response.body;
  assert.ok(body, "expected stream body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const normalized = buffer.replace(/\r\n/g, "\n");
    const chunks = normalized.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart());
      if (!dataLines.length) {
        continue;
      }

      events.push(JSON.parse(dataLines.join("\n")) as Record<string, unknown>);
    }
  }

  return events;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { sessionManager } = await createScriptPostgresSessionManager();
const routineRepository = createMemoryRoutineRepository();
const settingsRepository = createMemorySettingsRepository();
const defaultWorkspace = path.resolve(
  process.cwd(),
  DEFAULT_SESSION_WORKING_DIRECTORY
);
const traceManager = createFileTraceManager(
  resolveSessionStateDirectory(path.resolve(process.cwd()), "session-api-smoke")
);
const promptBuilder = createPromptBuilder();

const existingConflictRoutine = await routineRepository.create({
  userId: "api-user",
  name: "existing conflict",
  date: "2026-04-21",
  startTime: "14:00",
  endTime: "15:00",
  source: "user_confirmed"
});

const callState = new Map<string, number>();

function createFakeClient(session: SessionSnapshot): AnthropicCompatibleClient {
  let interruptedStreamAborted = false;
  async function respond(input: {
    messages: unknown;
  }): Promise<ReturnType<AnthropicCompatibleClient["messages"]["create"]>> {
    const callCount = (callState.get(session.sessionId) ?? 0) + 1;
    callState.set(session.sessionId, callCount);
    const lastMessage = JSON.stringify(input.messages);

    if (lastMessage.includes("simple response")) {
      return Promise.resolve({
        content: [{ type: "text", text: "Simple answer." }]
      });
    }

    if (lastMessage.includes("conflict request")) {
      if (callCount === 1) {
        return Promise.resolve({
          content: [
            {
              type: "tool_use",
              id: "conflict-create",
              name: "create_routine",
              input: {
                name: "conflict meeting",
                date: "2026-04-21",
                start_time: "14:00",
                end_time: "15:00",
                source: "user_confirmed"
              }
            }
          ]
        });
      }

      return Promise.resolve({
        content: [
          {
            type: "text",
            text: "Cannot create the routine because it overlaps with the existing schedule."
          }
        ]
      });
    }

    if (callCount === 1) {
      return Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: "create-1",
            name: "create_routine",
            input: {
              name: "meeting",
              date: "2026-04-21",
              start_time: "10:00",
              end_time: "11:00",
              source: "user_confirmed"
            }
          }
        ]
      });
    }

    return Promise.resolve({
      content: [{ type: "text", text: "Created from SSE." }]
    });
  }

  return {
    messages: {
      create(input) {
        return respond(input) as ReturnType<
          AnthropicCompatibleClient["messages"]["create"]
        >;
      },
      stream(input) {
        const lastMessage = JSON.stringify(input.messages);
        if (!lastMessage.includes("interrupt request")) {
          return {
            async finalMessage() {
              return (await respond(input)) as Awaited<
                ReturnType<AnthropicCompatibleClient["messages"]["create"]>
              >;
            },
            async *[Symbol.asyncIterator]() {}
          };
        }

        return {
          abort() {
            interruptedStreamAborted = true;
          },
          async finalMessage() {
            return {
              content: [{ type: "text", text: "Interrupt partial" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 10,
                output_tokens: 3,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          },
          async *[Symbol.asyncIterator]() {
            yield {
              type: "content_block_start" as const,
              index: 0,
              content_block: {
                type: "text" as const,
                text: ""
              }
            };
            yield {
              type: "content_block_delta" as const,
              index: 0,
              delta: {
                type: "text_delta" as const,
                text: "Interrupt partial"
              }
            };
            await sleep(400);
            if (interruptedStreamAborted) {
              return;
            }
            yield {
              type: "content_block_delta" as const,
              index: 0,
              delta: {
                type: "text_delta" as const,
                text: " should not finish"
              }
            };
            yield {
              type: "content_block_stop" as const,
              index: 0
            };
            yield {
              type: "message_delta" as const,
              delta: {
                stop_reason: "end_turn"
              },
              usage: {
                input_tokens: 10,
                output_tokens: 3,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
            yield {
              type: "message_stop" as const
            };
          }
        };
      }
    }
  };
}

const app = createApiApp({
  sessionManager,
  routineRepository,
  settingsRepository,
  traceManager,
  buildWorkingDirectory: (input) =>
    input ? path.resolve(process.cwd(), input) : defaultWorkspace,
  defaultModel: "MiniMax-M2.7",
  runtimeFactory(session) {
    return createAgentRuntime({
      client: createFakeClient(session),
      model: session.model,
      sessionManager,
      routineRepository,
      toolRegistry: createScheduleToolRegistry({ routineRepository }),
      traceManager,
      promptBuilder,
      maxTurns: 6,
      maxTokens: 128
    });
  }
});

async function createSession(
  input: {
    userId?: string;
    workingDirectory?: string;
    yoloMode?: boolean;
  } = {}
) {
  const response = await app.request("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId ?? "api-user",
      ...(input.workingDirectory
        ? { workingDirectory: input.workingDirectory }
        : {}),
      ...(typeof input.yoloMode === "boolean"
        ? { yoloMode: input.yoloMode }
        : {})
    })
  });
  const payload = (await response.json()) as { session: SessionSnapshot };
  return payload.session;
}

async function updateUserSettings(
  userId: string,
  patch: {
    yoloMode?: boolean;
    toolAllowList?: string[];
    toolAskList?: string[];
    toolDenyList?: string[];
  }
) {
  const response = await app.request(`/users/${userId}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  assert.equal(response.status, 200);
}

await updateUserSettings("api-user", {
  toolAllowList: ["create_routine"]
});

await routineRepository.create({
  userId: "reset-user",
  name: "reset breakfast",
  date: "2026-04-22",
  startTime: "08:00",
  endTime: "09:00",
  source: "user_confirmed"
});
await routineRepository.create({
  userId: "reset-user",
  name: "reset workout",
  date: "2026-04-23",
  startTime: "18:00",
  endTime: "19:00",
  source: "user_confirmed"
});

const resetSession = await createSession({ userId: "reset-user" });
const resetResponse = await app.request(
  `/sessions/${resetSession.sessionId}/routines/reset`,
  {
    method: "POST"
  }
);
const resetPayload = (await resetResponse.json()) as {
  sessionId: string;
  resetCount: number;
};
assert.equal(resetPayload.sessionId, resetSession.sessionId);
assert.equal(resetPayload.resetCount, 2);

const resetListResponse = await app.request(
  `/sessions/${resetSession.sessionId}/routines?startDate=2026-04-22&endDate=2026-04-23`
);
const resetListPayload = (await resetListResponse.json()) as {
  routines: unknown[];
};
assert.equal(resetListPayload.routines.length, 0);

const simpleSession = await createSession();
const simpleResponse = await app.request(
  `/sessions/${simpleSession.sessionId}/execute/stream`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "simple response", maxTurns: 2 })
  }
);
const simpleEvents = await readSse(simpleResponse);
assert.equal(simpleEvents.at(-1)?.kind, "run_complete");
assert.equal(
  simpleEvents.filter((event) => event.kind === "assistant_text").length,
  1
);

const createSessionSnapshot = await createSession();
const createResponse = await app.request(
  `/sessions/${createSessionSnapshot.sessionId}/execute/stream`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "create request" })
  }
);
const createEvents = await readSse(createResponse);
assert.ok(createEvents.some((event) => event.kind === "tool_call"));
assert.ok(createEvents.some((event) => event.kind === "tool_result"));

const limitedSession = await createSession();
const limitedResponse = await app.request(
  `/sessions/${limitedSession.sessionId}/execute/stream`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "create request", maxTurns: 1 })
  }
);
const limitedEvents = await readSse(limitedResponse);
assert.ok(
  limitedEvents.some((event) => event.kind === "fallback"),
  "expected fallback when maxTurns=1"
);

const interruptSession = await createSession();
const interruptResponse = await app.request(
  `/sessions/${interruptSession.sessionId}/execute/stream`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "interrupt request" })
  }
);
const interruptEventsPromise = readSse(interruptResponse);
await sleep(50);
const interruptAcceptResponse = await app.request(
  `/sessions/${interruptSession.sessionId}/interrupt`,
  {
    method: "POST"
  }
);
assert.equal(interruptAcceptResponse.status, 200);
const interruptAcceptPayload = (await interruptAcceptResponse.json()) as {
  accepted: boolean;
  session: SessionSnapshot;
};
assert.equal(interruptAcceptPayload.accepted, true);
assert.equal(interruptAcceptPayload.session.sessionState.interruptRequested, true);

const interruptEvents = await interruptEventsPromise;
const interruptFinal = interruptEvents.at(-1) as {
  kind: string;
  status?: string;
  stopReason?: string;
  session?: SessionSnapshot;
};
assert.equal(interruptFinal.kind, "run_complete");
assert.equal(interruptFinal.status, "interrupted");
assert.equal(interruptFinal.stopReason, "interrupted_by_user");
assert.equal(interruptFinal.session?.sessionState.loopState, "interrupted");
assert.equal(interruptFinal.session?.context.status, "waiting_for_user_input");
assert.equal(
  interruptEvents.some((event) => event.kind === "interrupt_requested"),
  true
);
assert.equal(
  interruptEvents.some((event) => event.kind === "interrupted"),
  true
);

const idleInterruptResponse = await app.request(
  `/sessions/${simpleSession.sessionId}/interrupt`,
  {
    method: "POST"
  }
);
assert.equal(idleInterruptResponse.status, 409);

const conflictSession = await createSession();
const conflictResponse = await app.request(
  `/sessions/${conflictSession.sessionId}/execute/stream`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "conflict request" })
  }
);
const conflictEvents = await readSse(conflictResponse);
const conflictFinal = conflictEvents.at(-1) as {
  kind: string;
  session?: SessionSnapshot;
};
assert.equal(conflictFinal.kind, "run_complete");
assert.ok(
  conflictEvents.some(
    (event) => event.kind === "tool_result" && event.isError === true
  )
);
assert.equal(conflictFinal.session?.context.status, "completed");
assert.equal(conflictFinal.session?.sessionState.loopState, "completed");
assert.equal(conflictFinal.session?.context.pendingConfirmationPayload, null);

const routinesAfterConflict = await routineRepository.listByDateRange(
  "api-user",
  "2026-04-21",
  "2026-04-21"
);
assert.equal(
  routinesAfterConflict.some(
    (routine) => routine.id === existingConflictRoutine.id
  ),
  true
);
assert.equal(
  routinesAfterConflict.some((routine) => routine.name === "conflict meeting"),
  false
);

let releaseBusyDeleteRun: (() => void) | null = null;
const busyDeleteSession = await createSession();

const configuredSession = await createSession({
  userId: "configured-user",
  workingDirectory: "apps/web",
  yoloMode: true
});
assert.equal(
  configuredSession.workingDirectory,
  path.resolve(process.cwd(), "apps/web")
);
assert.equal(configuredSession.context.yoloMode, true);

const settingsResponse = await app.request(
  `/sessions/${configuredSession.sessionId}/settings`,
  {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yoloMode: false })
  }
);
assert.equal(settingsResponse.status, 200);
const settingsPayload = (await settingsResponse.json()) as {
  session: SessionSnapshot;
};
assert.equal(settingsPayload.session.context.yoloMode, false);
const busyDeleteRuntime = createAgentRuntime({
  client: {
    messages: {
      async create() {
        await new Promise<void>((resolve) => {
          releaseBusyDeleteRun = resolve;
        });
        return {
          content: [{ type: "text", text: "Busy delete run completed." }]
        };
      }
    }
  },
  model: busyDeleteSession.model,
  sessionManager,
  routineRepository,
  toolRegistry: createScheduleToolRegistry({ routineRepository }),
  traceManager,
  promptBuilder,
  maxTurns: 2,
  maxTokens: 128
});

const busyDeleteRunPromise = busyDeleteRuntime.run({
  sessionId: busyDeleteSession.sessionId,
  message: "Hold this session open for delete."
});

await new Promise((resolve) => setTimeout(resolve, 0));

const deleteWhileRunningResponse = await app.request(
  `/sessions/${busyDeleteSession.sessionId}`,
  {
    method: "DELETE"
  }
);
assert.equal(deleteWhileRunningResponse.status, 409);

releaseBusyDeleteRun?.();
await busyDeleteRunPromise;

const deleteAfterRunResponse = await app.request(
  `/sessions/${busyDeleteSession.sessionId}`,
  {
    method: "DELETE"
  }
);
assert.equal(deleteAfterRunResponse.status, 204);

const traceResponse = await app.request(
  `/sessions/${createSessionSnapshot.sessionId}/trace`
);
const tracePayload = (await traceResponse.json()) as {
  events: Array<{ event: { kind: string } }>;
};
assert.ok(
  tracePayload.events.some((event) => event.event.kind === "prompt"),
  "expected persisted prompt event"
);

const deleteResponse = await app.request(
  `/sessions/${createSessionSnapshot.sessionId}`,
  {
    method: "DELETE"
  }
);
assert.equal(deleteResponse.status, 204);

const deletedSessionResponse = await app.request(
  `/sessions/${createSessionSnapshot.sessionId}`
);
assert.equal(deletedSessionResponse.status, 404);

const deletedTraceResponse = await app.request(
  `/sessions/${createSessionSnapshot.sessionId}/trace`
);
assert.equal(deletedTraceResponse.status, 404);

console.log(
  JSON.stringify(
    {
      ok: true,
      scenarios: {
        reset: resetPayload.resetCount,
        simple: simpleEvents.length,
        create: createEvents.length,
        limited: limitedEvents.length,
        interrupt: interruptEvents.length,
        conflict: conflictEvents.length,
        deleteWhileRunning: deleteWhileRunningResponse.status,
        idleInterrupt: idleInterruptResponse.status
      },
      deletedSessionId: busyDeleteSession.sessionId
    },
    null,
    2
  )
);
