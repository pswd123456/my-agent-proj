import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SESSION_MAX_TURNS,
  DEFAULT_SESSION_WORKING_DIRECTORY
} from "@ai-app-template/domain";

import { createMemorySettingsRepository } from "../src/settings-repository.js";

describe("MemorySettingsRepository", () => {
  test("seeds default settings per user on first read", async () => {
    const repository = createMemorySettingsRepository();

    const settings = await repository.getOrCreate("user-a");

    expect(settings.userId).toBe("user-a");
    expect(settings.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(settings.yoloMode).toBe(false);
    expect(settings.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(settings.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
  });

  test("updates one user's settings without affecting another user", async () => {
    const repository = createMemorySettingsRepository();

    await repository.update("user-a", {
      workingDirectory: "/tmp/custom-workspace",
      yoloMode: true,
      contextWindow: 123_456,
      maxTurns: 88
    });

    const userA = await repository.getOrCreate("user-a");
    const userB = await repository.getOrCreate("user-b");

    expect(userA.workingDirectory).toBe("/tmp/custom-workspace");
    expect(userA.yoloMode).toBe(true);
    expect(userA.contextWindow).toBe(123_456);
    expect(userA.maxTurns).toBe(88);

    expect(userB.workingDirectory).toBe(DEFAULT_SESSION_WORKING_DIRECTORY);
    expect(userB.yoloMode).toBe(false);
    expect(userB.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(userB.maxTurns).toBe(DEFAULT_SESSION_MAX_TURNS);
  });
});
