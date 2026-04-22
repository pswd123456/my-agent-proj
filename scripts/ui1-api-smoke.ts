import assert from "node:assert/strict";
import path from "node:path";

import {
  createAgentRuntime,
  createScheduleToolRegistry,
  createFileTraceManager,
  createMemorySessionManager,
  createPromptBuilder,
  resolveSessionStateDirectory,
  type AnthropicCompatibleClient,
  type SessionSnapshot
} from "../packages/agent/src/index.ts";
import { createMemoryRoutineRepository } from "../packages/db/src/index.ts";
import { createApiApp } from "../apps/api/src/app.ts";

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

const sessionManager = createMemorySessionManager();
const routineRepository = createMemoryRoutineRepository();
const traceManager = createFileTraceManager(
  resolveSessionStateDirectory(path.resolve(process.cwd()), "ui1-api-smoke")
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
  return {
    messages: {
      async create(input) {
        const callCount = (callState.get(session.sessionId) ?? 0) + 1;
        callState.set(session.sessionId, callCount);
        const lastMessage = JSON.stringify(input.messages);

        if (lastMessage.includes("simple response")) {
          return {
            content: [{ type: "text", text: "Simple answer." }]
          };
        }

        if (lastMessage.includes("conflict request")) {
          if (callCount === 1) {
            return {
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
            };
          }

          return {
            content: [
              {
                type: "text",
                text: "Cannot create the routine because it overlaps with the existing schedule."
              }
            ]
          };
        }

        if (callCount === 1) {
          return {
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
          };
        }

        return {
          content: [{ type: "text", text: "Created from SSE." }]
        };
      }
    }
  };
}

const app = createApiApp({
  sessionManager,
  routineRepository,
  traceManager,
  buildWorkingDirectory: (input) => input ?? process.cwd(),
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

async function createSession(userId = "api-user") {
  const response = await app.request("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId })
  });
  const payload = (await response.json()) as { session: SessionSnapshot };
  return payload.session;
}

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

const resetSession = await createSession("reset-user");
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
        conflict: conflictEvents.length,
        deleteWhileRunning: deleteWhileRunningResponse.status
      },
      deletedSessionId: busyDeleteSession.sessionId
    },
    null,
    2
  )
);
