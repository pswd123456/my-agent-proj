import assert from "node:assert/strict";

import {
  createAgentRuntime,
  createPromptBuilder,
  createWorkspaceToolRegistry,
  type AnthropicCompatibleClient,
  type RunStreamEvent
} from "../packages/agent/src/index.ts";
import { createMemoryRoutineRepository } from "../packages/db/src/index.ts";
import { createScriptPostgresSessionManager } from "./postgres-session.ts";

const emittedEvents: RunStreamEvent[] = [];
const { sessionManager } = await createScriptPostgresSessionManager();
let callCount = 0;

const fakeClient: AnthropicCompatibleClient = {
  messages: {
    async create() {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: [
            {
              type: "text",
              text: '[TOOL_CALL]\n{tool => "list_directory", args => {\n  --path "."\n}}\n[/TOOL_CALL]'
            }
          ],
          stop_reason: "end_turn"
        };
      }

      return {
        content: [
          {
            type: "text",
            text: "Recovered tool call executed."
          }
        ],
        stop_reason: "end_turn"
      };
    }
  }
};

const runtime = createAgentRuntime({
  client: fakeClient,
  model: "MiniMax-M2.7",
  sessionManager,
  routineRepository: createMemoryRoutineRepository(),
  toolRegistry: createWorkspaceToolRegistry({
    workingDirectory: process.cwd()
  }),
  promptBuilder: createPromptBuilder(),
  maxTurns: 4,
  maxTokens: 128
});

const session = await runtime.createSession({
  workingDirectory: process.cwd(),
  model: "MiniMax-M2.7",
  userId: "text-tool-fallback-smoke"
});

const result = await runtime.run({
  sessionId: session.sessionId,
  message: "Inspect the workspace.",
  eventSink(event) {
    emittedEvents.push(event);
  }
});

assert.equal(result.status, "completed");
assert.equal(result.finalAnswer, "Recovered tool call executed.");
assert.equal(result.toolCallCount, 1);
assert.equal(result.toolResultCount, 1);
assert.ok(
  emittedEvents.some(
    (event) =>
      event.kind === "fallback" &&
      event.reason === "provider_text_tool_call"
  )
);
assert.ok(
  emittedEvents.some(
    (event) => event.kind === "tool_call" && event.toolName === "list_directory"
  )
);

console.log(
  JSON.stringify(
    {
      ok: true,
      sessionId: session.sessionId,
      toolCallCount: result.toolCallCount,
      toolResultCount: result.toolResultCount,
      finalAnswer: result.finalAnswer
    },
    null,
    2
  )
);
