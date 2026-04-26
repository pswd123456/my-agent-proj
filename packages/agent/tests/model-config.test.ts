import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MAX_TOKENS,
  resolveMaxTokens
} from "../src/model.js";

describe("resolveMaxTokens", () => {
  test("returns the default when no env override is set", () => {
    expect(resolveMaxTokens({})).toBe(DEFAULT_MAX_TOKENS);
  });

  test("prefers ANTHROPIC_MAX_TOKENS when set", () => {
    expect(
      resolveMaxTokens({
        ANTHROPIC_MAX_TOKENS: "2048",
        MAX_TOKENS: "1024"
      })
    ).toBe(2048);
  });

  test("falls back to the default for invalid values", () => {
    expect(resolveMaxTokens({ ANTHROPIC_MAX_TOKENS: "0" })).toBe(
      DEFAULT_MAX_TOKENS
    );
    expect(resolveMaxTokens({ MAX_TOKENS: "NaN" })).toBe(
      DEFAULT_MAX_TOKENS
    );
  });
});
