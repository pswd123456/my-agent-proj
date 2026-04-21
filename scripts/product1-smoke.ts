import assert from "node:assert/strict";

import {
  createAgentRuntime,
  createDefaultToolRegistry,
  createMemorySessionManager,
  createPromptBuilder,
  type AnthropicCompatibleClient
} from "../packages/agent/src/index.ts";
import { createMemoryRoutineRepository } from "../packages/db/src/index.ts";

async function runCreateFlow(): Promise<void> {
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  let callCount = 0;

  const fakeClient: AnthropicCompatibleClient = {
    messages: {
      async create() {
        callCount += 1;
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
    toolRegistry: createDefaultToolRegistry({ routineRepository }),
    promptBuilder: createPromptBuilder(),
    maxTurns: 4,
    maxTokens: 128
  });

  const session = await runtime.createSession({
    workingDirectory: process.cwd(),
    model: "MiniMax-M2.7",
    userId: "smoke-user"
  });

  const result = await runtime.run({
    sessionId: session.sessionId,
    message: "Tomorrow 10 to 11 add a meeting."
  });

  const routines = await routineRepository.listByDateRange(
    "smoke-user",
    "2026-04-21",
    "2026-04-21"
  );

  assert.equal(result.status, "completed");
  assert.equal(result.finalAnswer, "Created your routine.");
  assert.equal(result.toolOutputs.length, 1);
  assert.match(result.toolOutputs[0]?.displayText ?? "", /\[create_routine\] success/);
  assert.equal(routines.length, 1);
}

async function runConflictFlow(): Promise<void> {
  const sessionManager = createMemorySessionManager();
  const routineRepository = createMemoryRoutineRepository();
  await routineRepository.create({
    userId: "smoke-user",
    name: "dentist",
    date: "2026-04-21",
    startTime: "14:00",
    endTime: "15:00",
    source: "user_confirmed"
  });

  let callCount = 0;
  const fakeClient: AnthropicCompatibleClient = {
    messages: {
      async create() {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: [
              {
                type: "tool_use",
                id: "create-2",
                name: "create_routine",
                input: {
                  name: "meeting",
                  date: "2026-04-21",
                  start_time: "14:00",
                  end_time: "15:00",
                  source: "user_confirmed"
                }
              }
            ]
          };
        }

        if (callCount === 2) {
          return {
            content: [
              {
                type: "tool_use",
                id: "confirm-1",
                name: "ask_for_confirmation",
                input: {
                  summary_text: "The proposed meeting overlaps with dentist.",
                  proposed_items: [
                    {
                      preview_text: "2026-04-21 14:00-15:00 meeting",
                      tool_name: "create_routine",
                      tool_input: {
                        name: "meeting",
                        date: "2026-04-21",
                        start_time: "14:00",
                        end_time: "15:00",
                        source: "agent_suggested_confirmed"
                      }
                    }
                  ],
                  conflict_items: [
                    {
                      routine_id: "existing",
                      preview_text: "2026-04-21 14:00-15:00 dentist"
                    }
                  ]
                }
              }
            ]
          };
        }

        return {
          content: [
            {
              type: "text",
              text: "Please confirm whether I should overwrite the existing routine."
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
    toolRegistry: createDefaultToolRegistry({ routineRepository }),
    promptBuilder: createPromptBuilder(),
    maxTurns: 6,
    maxTokens: 128
  });

  const session = await runtime.createSession({
    workingDirectory: process.cwd(),
    model: "MiniMax-M2.7",
    userId: "smoke-user"
  });

  const result = await runtime.run({
    sessionId: session.sessionId,
    message: "Add a meeting tomorrow from 2 to 3."
  });

  assert.equal(result.status, "completed");
  assert.equal(result.toolOutputs.length, 2);
  assert.match(result.toolOutputs[0]?.displayText ?? "", /conflict detected/);
  assert.match(result.toolOutputs[1]?.displayText ?? "", /\[ask_for_confirmation\]/);
  assert.equal(result.session.context.status, "waiting_for_conflict_confirmation");
}

await runCreateFlow();
await runConflictFlow();

console.log(
  JSON.stringify(
    {
      ok: true,
      scenarios: ["create", "conflict_confirmation"]
    },
    null,
    2
  )
);
