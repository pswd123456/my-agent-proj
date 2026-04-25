import { describe, expect, test } from "bun:test";

import {
  getAssistantTextCursorVisible,
  getAssistantTextRenderMode,
  getNextTypewriterLength,
  getTypewriterVisibleLengthOnChange,
  splitTypewriterCharacters
} from "./message-typewriter";

describe("message typewriter helpers", () => {
  test("splits Unicode content by visible characters", () => {
    expect(splitTypewriterCharacters("你好🙂")).toEqual(["你", "好", "🙂"]);
  });

  test("advances reveal length without overshooting", () => {
    expect(getNextTypewriterLength(0, 5)).toBe(1);
    expect(getNextTypewriterLength(4, 5)).toBe(5);
    expect(getNextTypewriterLength(9, 5)).toBe(5);
    expect(getNextTypewriterLength(-2, 3)).toBe(1);
  });

  test("keeps current progress when the same streamed message grows", () => {
    expect(
      getTypewriterVisibleLengthOnChange({
        animate: true,
        itemChanged: false,
        animationStarted: false,
        totalLength: 20,
        previousTotalLength: 12,
        currentVisibleLength: 8
      })
    ).toBe(8);
  });

  test("restarts typing for a new message or a new animation cycle", () => {
    expect(
      getTypewriterVisibleLengthOnChange({
        animate: true,
        itemChanged: true,
        animationStarted: false,
        totalLength: 10,
        previousTotalLength: 10,
        currentVisibleLength: 6
      })
    ).toBe(0);

    expect(
      getTypewriterVisibleLengthOnChange({
        animate: true,
        itemChanged: false,
        animationStarted: true,
        totalLength: 10,
        previousTotalLength: 10,
        currentVisibleLength: 6
      })
    ).toBe(0);
  });

  test("shows full content immediately when animation is disabled", () => {
    expect(
      getTypewriterVisibleLengthOnChange({
        animate: false,
        itemChanged: false,
        animationStarted: false,
        totalLength: 14,
        previousTotalLength: 8,
        currentVisibleLength: 3
      })
    ).toBe(14);
  });

  test("keeps streamed markdown in plain text mode until the stream ends", () => {
    expect(
      getAssistantTextRenderMode({
        animate: true,
        streaming: true,
        totalLength: 48,
        visibleLength: 48
      })
    ).toBe("plaintext");
  });

  test("waits for the typewriter to catch up before switching back to markdown", () => {
    expect(
      getAssistantTextRenderMode({
        animate: true,
        streaming: false,
        totalLength: 48,
        visibleLength: 32
      })
    ).toBe("plaintext");

    expect(
      getAssistantTextRenderMode({
        animate: true,
        streaming: false,
        totalLength: 48,
        visibleLength: 48
      })
    ).toBe("markdown");
  });

  test("hides the cursor once the typewriter has caught up", () => {
    expect(
      getAssistantTextCursorVisible({
        animate: true,
        totalLength: 48,
        visibleLength: 32
      })
    ).toBe(true);

    expect(
      getAssistantTextCursorVisible({
        animate: true,
        totalLength: 48,
        visibleLength: 48
      })
    ).toBe(false);
  });
});
