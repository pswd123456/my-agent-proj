import { describe, expect, test } from "bun:test";

import {
  describeTaskBriefBinding,
  normalizeTaskBriefPlanName,
  isBoundTaskBriefPath,
  resolveLegacyTaskBriefPath,
  resolveTaskBriefPath,
  resolveTaskBriefPathForSession
} from "../src/session/task-brief.js";

describe("task brief path helpers", () => {
  test("normalizes a provided plan filename", () => {
    const planName = normalizeTaskBriefPlanName("Jump joy web game");

    expect(planName).toBe("jump_joy_web_game.md");
  });

  test("does not auto-bind a task brief path from the latest user task", () => {
    const resolved = resolveTaskBriefPathForSession({
      workingDirectory: "/tmp/workspace",
      sessionId: "session-1",
      planModeEnabled: true,
      firstUserMessage: null,
      lastUserMessage: "Build a jump joy web game"
    });

    expect(resolved).toBeNull();
  });

  test("accepts legacy flat task brief paths for existing sessions", () => {
    const legacyPath = resolveLegacyTaskBriefPath(
      "/tmp/workspace",
      "session-1"
    );

    expect(
      isBoundTaskBriefPath({
        workingDirectory: "/tmp/workspace",
        sessionId: "session-1",
        taskBriefPath: legacyPath
      })
    ).toBe(true);
  });

  test("describes unbound, named, and legacy binding states", () => {
    expect(
      describeTaskBriefBinding({
        workingDirectory: "/tmp/workspace",
        sessionId: "session-1",
        taskBriefPath: null
      })
    ).toEqual({
      state: "unbound",
      path: null,
      planFileName: null
    });

    expect(
      describeTaskBriefBinding({
        workingDirectory: "/tmp/workspace",
        sessionId: "session-1",
        taskBriefPath: resolveLegacyTaskBriefPath("/tmp/workspace", "session-1")
      })
    ).toEqual({
      state: "bound_legacy",
      path: resolveLegacyTaskBriefPath("/tmp/workspace", "session-1"),
      planFileName: null
    });

    expect(
      describeTaskBriefBinding({
        workingDirectory: "/tmp/workspace",
        sessionId: "session-1",
        taskBriefPath: resolveTaskBriefPath(
          "/tmp/workspace",
          "session-1",
          "jump_joy_web_game.md"
        )
      })
    ).toEqual({
      state: "bound_named",
      path: resolveTaskBriefPath(
        "/tmp/workspace",
        "session-1",
        "jump_joy_web_game.md"
      ),
      planFileName: "jump_joy_web_game.md"
    });
  });
});
