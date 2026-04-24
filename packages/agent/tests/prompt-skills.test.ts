import { describe, expect, test } from "bun:test";

import { createCreateRoutineTool } from "../src/tools/create-routine.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createPromptBuilder } from "../src/prompt.js";
import type { SessionSnapshot } from "../src/types.js";

function createSessionSnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "test-user",
      status: "completed",
      yoloMode: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingConflictSummary: null,
      currentDateContext: "2026-04-22",
      lastUserMessage: null
    },
    messages: [],
    sessionState: {
      loopState: "idle",
      turnCount: 0,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: new Date().toISOString()
  };
}

describe("PromptBuilder skill context", () => {
  test("injects a skill list into runtime context messages", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry();

    const promptEnvelope = promptBuilder.build(
      session,
      toolRegistry,
      {
        currentDateTimeContext: "2026-04-22 10:00",
        currentTimeZone: "Asia/Shanghai"
      },
      [
        {
          name: "repo_reader",
          description: "Read repository structure before implementation.",
          relativePath: ".agent/skills/repo-reader/SKILL.md"
        }
      ]
    );

    expect(promptEnvelope.system).toContain(
      "Actively utilize the skills listed in the runtime context"
    );
    expect(promptEnvelope.system).toContain(
      "Only rely on skills explicitly listed in the current runtime context"
    );
    expect(promptEnvelope.runtimeContextMessages).toHaveLength(2);
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "repo_reader"
    );
    expect(
      JSON.stringify(promptEnvelope.runtimeContextMessages[1])
    ).not.toContain(".agent/skills/repo-reader/SKILL.md");
  });

  test("renders none when no skills are available", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());

    expect(promptEnvelope.system).toContain(
      "You are a personal assistant operating a CLI-first workspace runtime."
    );
    expect(promptEnvelope.system).not.toMatch(
      /scheduling agent.*routine manager/i
    );
    expect(promptEnvelope.runtimeContextMessages).toHaveLength(2);
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "none"
    );
  });

  test("adds routine guidance only when routine tools are mounted", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry().register(createCreateRoutineTool());

    const promptEnvelope = promptBuilder.build(session, toolRegistry);

    expect(promptEnvelope.system).toContain(
      "Routine-management tools are currently mounted as one capability pack in this runtime."
    );
    expect(promptEnvelope.system).toContain(
      "You may call create_routine directly only when the requested change is safe and conflict-free."
    );
  });
});
