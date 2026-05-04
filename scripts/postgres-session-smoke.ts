import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createAgentRuntime,
  createScheduleToolRegistry,
  createPostgresSessionManager,
  createPromptBuilder,
  SessionExecutionInProgressError,
  type AnthropicCompatibleClient
} from "../packages/agent/src/index.ts";
import {
  createMemoryRoutineRepository,
  createPostgresDatabase,
  ensureProductSchema
} from "../packages/db/src/index.ts";

function loadEnvFromDotEnv(pathname = ".env"): Record<string, string> {
  return Object.fromEntries(
    readFileSync(pathname, "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .filter((line) => !line.trimStart().startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      })
  );
}

const env = loadEnvFromDotEnv();
const databaseUrl = env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for postgres-session-smoke.");
}

const database = createPostgresDatabase(databaseUrl);
await ensureProductSchema(database);

const sessionManager = createPostgresSessionManager(database);
const promptBuilder = createPromptBuilder();
const createdSessionIds: string[] = [];

try {
  const conflictRepository = createMemoryRoutineRepository();
  const conflictToolRegistry = createScheduleToolRegistry();

  let conflictCallCount = 0;
  const conflictClient: AnthropicCompatibleClient = {
    messages: {
      async create() {
        conflictCallCount += 1;

        if (conflictCallCount === 1) {
          return {
            content: [
              {
                type: "tool_use",
                id: "search-1",
                name: "query_routines",
                input: {
                  action: "by_time",
                  date: "2026-04-21",
                  time: "14:00"
                }
              }
            ]
          };
        }

        return {
          content: [
            {
              type: "tool_use",
              id: "confirm-1",
              name: "ask_for_confirmation",
              input: {
                summary_text: "Conflict detected.",
                proposed_items: [
                  {
                    preview_text: "Move reading to 16:00-17:00",
                    tool_name: "manage_routine",
                    tool_input: {
                      action: "create",
                      name: "读书",
                      date: "2026-04-21",
                      start_time: "16:00",
                      end_time: "17:00",
                      source: "agent_suggested_confirmed"
                    }
                  }
                ],
                conflict_items: [
                  {
                    routine_id: "existing-1",
                    preview_text: "读书 14:00-15:00"
                  }
                ]
              }
            }
          ]
        };
      }
    }
  };

  const conflictRuntime = createAgentRuntime({
    client: conflictClient,
    model: "MiniMax-M2.7",
    sessionManager,
    routineRepository: conflictRepository,
    toolRegistry: conflictToolRegistry,
    promptBuilder,
    maxTurns: 4,
    maxTokens: 128
  });

  const conflictSession = await conflictRuntime.createSession({
    workingDirectory: process.cwd(),
    model: "MiniMax-M2.7",
    userId: "postgres-smoke"
  });
  createdSessionIds.push(conflictSession.sessionId);

  const conflictResult = await conflictRuntime.run({
    sessionId: conflictSession.sessionId,
    message: "Please resolve the conflict."
  });

  assert.equal(conflictResult.status, "waiting for input");
  assert.equal(
    conflictResult.session.context.status,
    "waiting_for_conflict_confirmation"
  );
  assert.ok(conflictResult.session.context.pendingConfirmationPayload);

  const reloadedConflictSession = await sessionManager.getSession(
    conflictSession.sessionId
  );
  assert.ok(reloadedConflictSession);
  assert.ok(reloadedConflictSession.context.pendingConfirmationPayload);

  const promptEnvelope = promptBuilder.build(
    reloadedConflictSession,
    conflictToolRegistry
  );
  const promptText = JSON.stringify(promptEnvelope);
  assert.match(promptText, /Conflict detected\./);
  assert.match(promptText, /"time":"14:00"/);
  assert.doesNotMatch(promptText, /Pending confirmation payload: none/);

  let releaseBusyRun: (() => void) | null = null;
  let resolveBusyRunStarted: (() => void) | null = null;
  const busyRunStarted = new Promise<void>((resolve) => {
    resolveBusyRunStarted = resolve;
  });
  const busyRepository = createMemoryRoutineRepository();
  const busyRuntime = createAgentRuntime({
    client: {
      messages: {
        async create() {
          resolveBusyRunStarted?.();
          resolveBusyRunStarted = null;
          await new Promise<void>((resolve) => {
            releaseBusyRun = resolve;
          });

          return {
            content: [{ type: "text", text: "Busy run completed." }]
          };
        }
      }
    },
    model: "MiniMax-M2.7",
    sessionManager,
    routineRepository: busyRepository,
    toolRegistry: createScheduleToolRegistry(),
    promptBuilder,
    maxTurns: 2
  });

  const busySession = await busyRuntime.createSession({
    workingDirectory: process.cwd(),
    model: "MiniMax-M2.7",
    userId: "postgres-smoke"
  });
  createdSessionIds.push(busySession.sessionId);

  const busyRunPromise = busyRuntime.run({
    sessionId: busySession.sessionId,
    message: "Hold this postgres-backed run open."
  });

  await busyRunStarted;

  await assert.rejects(
    () =>
      busyRuntime.run({
        sessionId: busySession.sessionId,
        message: "This second postgres-backed run must be rejected."
      }),
    (error) => error instanceof SessionExecutionInProgressError
  );

  releaseBusyRun?.();
  const busyResult = await busyRunPromise;
  assert.equal(busyResult.finalAnswer, "Busy run completed.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        sessions: createdSessionIds.length,
        promptContainsPendingConfirmation: true,
        duplicateExecutionRejected: true
      },
      null,
      2
    )
  );
} finally {
  for (const sessionId of createdSessionIds) {
    await sessionManager.deleteSession(sessionId);
  }

  await database.$client.end({ timeout: 1 });
}
