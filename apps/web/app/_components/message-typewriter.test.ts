import { describe, expect, test } from "bun:test";

import {
  getNextTypewriterLength,
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
});
