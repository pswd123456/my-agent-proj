import { describe, expect, test } from "bun:test";

import {
  createSessionPayloadSchema,
  updateSessionSettingsPayloadSchema,
  updateUserSettingsPayloadSchema
} from "../src/settings-payload-schema.js";

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
});
