import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createMemorySessionManager } from "../src/session/index.js";
import { executeToolAction } from "../src/runtime/tool-execution.js";
import type { TraceEvent, TraceManager, TraceRecord } from "../src/trace.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { RuntimeTool } from "../src/tools/runtime-tool.js";

class MemoryTraceManager implements TraceManager {
  readonly events: TraceEvent[] = [];

  async appendEvent(_sessionId: string, event: TraceEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async readEvents(_sessionId: string): Promise<TraceRecord[]> {
    return [];
  }

  async deleteEvents(_sessionId: string): Promise<void> {
    this.events.length = 0;
  }
}

describe("tool execution", () => {
  test("stores full tool results in session messages and trace", async () => {
    const longContent = [
      "A".repeat(2_800),
      "middle-content-that-must-survive",
      "B".repeat(1_400)
    ].join("\n");
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const traceManager = new MemoryTraceManager();
    const details = {
      kind: "workspace_file_changes" as const,
      files: [
        {
          path: "src/example.ts",
          action: "modify" as const,
          addedLineCount: 3,
          removedLineCount: 2,
          diff: "--- src/example.ts\n+++ src/example.ts\n@@ -1,2 +1,3 @@\n-old\n+new"
        }
      ]
    };
    const toolRegistry = new ToolRegistry().register({
      name: "large_output_tool",
      description: "Returns a large deterministic payload.",
      family: "workspace-file",
      isReadOnly: true,
      hasExternalSideEffect: false,
      permissionProfile: "allow",
      sandboxProfile: "none",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      validate() {
        return { ok: true, value: {} };
      },
      async execute() {
        return {
          state: "success",
          content: longContent,
          displayText: "large output",
          details,
          result: {
            ok: true,
            code: "OK",
            message: "Returned large output."
          }
        };
      }
    } satisfies RuntimeTool);

    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "tool-execution-user"
    });

    const executed = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry,
      traceManager,
      session,
      turnCount: 1,
      toolCallId: "call-large-output",
      toolName: "large_output_tool",
      toolInput: {},
      eventSink: undefined
    });

    expect(executed.kind).toBe("completed");
    if (executed.kind !== "completed") {
      throw new Error("expected completed tool execution");
    }
    expect(executed.output.content).toBe(longContent);
    expect(executed.output.details).toEqual(details);

    const persisted = await sessionManager.getSession(session.sessionId);
    const toolResult = persisted?.messages.find(
      (block) => block.kind === "tool result"
    );
    expect(toolResult?.kind).toBe("tool result");
    if (toolResult?.kind !== "tool result") {
      throw new Error("expected persisted tool result");
    }
    expect(toolResult.output).toBe(longContent);
    expect(toolResult.details).toEqual(details);
    expect(toolResult.output).toContain("middle-content-that-must-survive");
    expect(toolResult.output).not.toContain("Tool result compacted");

    const traceToolResult = traceManager.events.find(
      (event): event is Extract<TraceEvent, { kind: "tool_result" }> =>
        event.kind === "tool_result"
    );
    expect(traceToolResult?.output).toBe(longContent);
    expect(traceToolResult?.details).toEqual(details);
  });
});
