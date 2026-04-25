import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createAgentRuntime,
  createWorkspaceToolRegistry,
  createFileSessionManager,
  createPromptBuilder,
  resolveSessionStateDirectory,
  type AnthropicCompatibleClient,
  type AnthropicMessage
} from "../packages/agent/src/index.ts";
import { createMemoryRoutineRepository } from "../packages/db/src/index.ts";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const smokeRoot = resolveSessionStateDirectory(workspaceRoot, "stage1-smoke");
await rm(smokeRoot, { recursive: true, force: true });
const sessionManager = createFileSessionManager(smokeRoot);
const promptBuilder = createPromptBuilder();
const toolRegistry = createWorkspaceToolRegistry({
  workingDirectory: workspaceRoot
});
const routineRepository = createMemoryRoutineRepository();

const calls: AnthropicMessage[][] = [];

const fakeClient: AnthropicCompatibleClient = {
  messages: {
    async create(input) {
      calls.push(input.messages);

      assert.equal(input.model, "MiniMax-M2.7");
      assert.ok(
        input.system.includes(
          "You are a personal assistant."
        )
      );
      assert.ok(
        !/scheduling agent.*routine manager/i.test(input.system)
      );
      assert.deepEqual(
        input.tools.map((tool) => tool.name),
        [
          "copy_path",
          "create_directory",
          "delete_path",
          "edit_file",
          "list_directory",
          "make_http_request",
          "move_path",
          "read_file",
          "run_shell_command",
          "search_text",
          "write_file"
        ]
      );

      if (calls.length === 1) {
        return {
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "list_directory",
              input: {
                path: "."
              }
            }
          ],
          stop_reason: "tool_use",
          usage: {
            input_tokens: 48
          }
        };
      }

      return {
        content: [
          {
            type: "text",
            text: "pong"
          }
        ],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 21
        }
      };
    }
  }
};

const runtime = createAgentRuntime({
  client: fakeClient,
  model: "MiniMax-M2.7",
  sessionManager,
  routineRepository,
  toolRegistry,
  promptBuilder,
  maxTurns: 4,
  maxTokens: 128
});

const session = await runtime.createSession({
  workingDirectory: workspaceRoot,
  model: "MiniMax-M2.7"
});

const result = await runtime.run({
  sessionId: session.sessionId,
  message: "Please inspect the workspace and answer pong."
});

const snapshot = await sessionManager.getSession(session.sessionId);

assert.equal(result.status, "completed");
assert.equal(result.finalAnswer, "pong");
assert.equal(result.toolCallCount, 1);
assert.equal(result.toolResultCount, 1);
assert.ok(snapshot);
if (!snapshot) {
  throw new Error("Missing snapshot after runtime execution.");
}
assert.equal(snapshot.sessionState.loopState, "completed");
assert.equal(snapshot.inputTokensCount, 69);

const recovered = await sessionManager.recover(snapshot);
assert.equal(recovered.sessionId, snapshot.sessionId);
assert.equal(recovered.messages.length, snapshot.messages.length);

await rm(smokeRoot, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      sessionId: session.sessionId,
      turns: calls.length,
      toolCalls: result.toolCallCount,
      toolResults: result.toolResultCount,
      finalAnswer: result.finalAnswer
    },
    null,
    2
  )
);
