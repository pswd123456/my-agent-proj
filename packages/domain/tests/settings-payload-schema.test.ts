import { describe, expect, test } from "bun:test";

import {
  buildSessionSettingsPatchFromRecord,
  createSessionPayloadSchema,
  updateSessionSettingsPayloadSchema,
  updateUserSettingsPayloadSchema
} from "../src/index.js";

describe("settings payload schema", () => {
  test("allows plan mode in create session and session settings payloads", () => {
    expect(
      createSessionPayloadSchema.parse({
        planModeEnabled: true
      })
    ).toEqual({
      planModeEnabled: true
    });

    expect(
      updateSessionSettingsPayloadSchema.parse({
        planModeEnabled: false
      })
    ).toEqual({
      planModeEnabled: false
    });
  });

  test("requires at least one field for update payloads", () => {
    expect(() => updateSessionSettingsPayloadSchema.parse({})).toThrow(
      "At least one session settings field is required."
    );
    expect(() => updateUserSettingsPayloadSchema.parse({})).toThrow(
      "At least one settings field is required."
    );
  });

  test("keeps numeric validation on shared settings fields", () => {
    expect(() =>
      updateUserSettingsPayloadSchema.parse({
        contextWindow: 999
      })
    ).toThrow();

    expect(() =>
      updateUserSettingsPayloadSchema.parse({
        maxTurns: 0
      })
    ).toThrow();

    expect(
      updateUserSettingsPayloadSchema.parse({
        contextWindow: 1000,
        maxTurns: 1
      })
    ).toEqual({
      contextWindow: 1000,
      maxTurns: 1
    });
  });

  test("derives session-syncable settings patch from a settings record", () => {
    expect(
      buildSessionSettingsPatchFromRecord({
        workingDirectory: "agent-workspace",
        model: "deepseek-v4-pro",
        thinkingEffort: "max",
        yoloMode: true,
        contextWindow: 123_456,
        maxTurns: 77,
        shellAllowPatterns: ["git *"],
        shellDenyPatterns: ["rm *"],
        toolAllowList: ["read_file"],
        toolAskList: ["write_file"],
        toolDenyList: ["delete_path"],
        enabledCapabilityPacks: ["workspace"],
        workspaceSkillSettings: [],
        userContextHooks: [],
        debugConversationView: true,
        userCustomPrompt: "先确认上下文。",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      })
    ).toEqual({
      yoloMode: true,
      thinkingEffort: "max",
      shellAllowPatterns: ["git *"],
      shellDenyPatterns: ["rm *"],
      toolAllowList: ["read_file"],
      toolAskList: ["write_file"],
      toolDenyList: ["delete_path"],
      enabledCapabilityPacks: ["workspace"]
    });
  });
});
