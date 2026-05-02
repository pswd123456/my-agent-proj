import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime } from "../src/index.js";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { RuntimeTool } from "../src/tools/runtime-tool.js";

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function createReadProbeTool(state: {
  activeReads: number;
  maxActiveReads: number;
}): RuntimeTool {
  return {
    name: "read_probe",
    description: "Returns a deterministic read probe payload.",
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" }
      },
      required: ["value"],
      additionalProperties: false
    },
    validate(input) {
      return {
        ok: typeof input.value === "string",
        ...(typeof input.value === "string" ? { value: input } : {})
      };
    },
    async execute(input) {
      state.activeReads += 1;
      state.maxActiveReads = Math.max(state.maxActiveReads, state.activeReads);
      await delay(40);
      state.activeReads -= 1;

      return {
        state: "success",
        content: `read:${input.value}`,
        displayText: `read ${input.value}`,
        result: {
          ok: true,
          code: "OK",
          message: "Read probe completed."
        }
      };
    }
  };
}

function createWriteProbeTool(state: {
  activeReads: number;
  writeObservedReadInFlight: boolean;
}): RuntimeTool {
  return {
    name: "write_probe",
    description: "Returns a deterministic write probe payload.",
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" }
      },
      required: ["value"],
      additionalProperties: false
    },
    validate(input) {
      return {
        ok: typeof input.value === "string",
        ...(typeof input.value === "string" ? { value: input } : {})
      };
    },
    async execute(input) {
      state.writeObservedReadInFlight ||= state.activeReads > 0;
      await delay(5);

      return {
        state: "success",
        content: `write:${input.value}`,
        displayText: `write ${input.value}`,
        result: {
          ok: true,
          code: "OK",
          message: "Write probe completed."
        }
      };
    }
  };
}

describe("tool orchestration", () => {
  test("runs consecutive concurrency-safe tools in parallel and preserves the serial boundary for mutations", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const state = {
      activeReads: 0,
      maxActiveReads: 0,
      writeObservedReadInFlight: false
    };
    let modelCallCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            modelCallCount += 1;

            if (modelCallCount === 1) {
              return {
                content: [
                  {
                    type: "tool_use" as const,
                    id: "call-read-1",
                    name: "read_probe",
                    input: { value: "one" }
                  },
                  {
                    type: "tool_use" as const,
                    id: "call-read-2",
                    name: "read_probe",
                    input: { value: "two" }
                  },
                  {
                    type: "tool_use" as const,
                    id: "call-write-1",
                    name: "write_probe",
                    input: { value: "done" }
                  }
                ],
                stop_reason: "tool_use" as const
              };
            }

            return {
              content: [{ type: "text" as const, text: "done" }],
              stop_reason: "end_turn" as const
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry()
        .register(createReadProbeTool(state))
        .register(createWriteProbeTool(state)),
      maxTurns: 3,
      maxTokens: 128
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "tool-orchestration-user"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "Inspect first, then write once."
    });

    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("done");
    expect(modelCallCount).toBe(2);
    expect(state.maxActiveReads).toBe(2);
    expect(state.writeObservedReadInFlight).toBe(false);
    expect(result.toolOutputs.map((output) => output.content)).toEqual([
      "read:one",
      "read:two",
      "write:done"
    ]);
    expect(
      result.session.messages
        .filter((block) => block.kind === "tool result")
        .map((block) => block.output)
    ).toEqual(["read:one", "read:two", "write:done"]);
  });
});
