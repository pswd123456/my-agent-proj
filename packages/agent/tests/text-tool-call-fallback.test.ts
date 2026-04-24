import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime, type RunStreamEvent } from "../src/index.js";
import { createMemorySessionManager } from "../src/session/index.js";
import { createWorkspaceToolRegistry } from "../src/tools/index.js";

describe("text tool call fallback", () => {
  test("does not persist raw TOOL_CALL markup as assistant text", async () => {
    let callCount = 0;
    const emittedEvents: RunStreamEvent[] = [];
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            callCount += 1;
            if (callCount === 1) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text:
                      '先看一下目录。\n\n[TOOL_CALL]\n{tool => "list_directory", args => {\n  --path "."\n}}\n[/TOOL_CALL]'
                  }
                ],
                stop_reason: "end_turn" as const
              };
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: "Recovered tool call executed."
                }
              ],
              stop_reason: "end_turn" as const
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: createWorkspaceToolRegistry({
        workingDirectory: process.cwd()
      }),
      maxTurns: 4,
      maxTokens: 128
    });

    const session = await runtime.createSession({
      workingDirectory: process.cwd(),
      model: "MiniMax-M2.7",
      userId: "text-tool-fallback-test"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "Inspect the workspace.",
      eventSink(event) {
        emittedEvents.push(event);
      }
    });

    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("Recovered tool call executed.");

    const assistantBlocks = result.session.messages.filter(
      (block): block is Extract<typeof result.session.messages[number], { kind: "assistant" }> =>
        block.kind === "assistant"
    );

    expect(assistantBlocks.map((block) => block.content)).toEqual([
      "先看一下目录。",
      "Recovered tool call executed."
    ]);
    expect(
      assistantBlocks.some((block) => block.content.includes("[TOOL_CALL]"))
    ).toBe(false);

    const assistantTextEvents = emittedEvents.filter(
      (event): event is Extract<RunStreamEvent, { kind: "assistant_text" }> =>
        event.kind === "assistant_text"
    );
    expect(assistantTextEvents[0]?.text).toBe("先看一下目录。");
    expect(
      emittedEvents.some(
        (event) => event.kind === "tool_call" && event.toolName === "list_directory"
      )
    ).toBe(true);
  });
});
