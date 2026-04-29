import { describe, expect, test } from "bun:test";

import { resolveSessionRailCollapsedState } from "./session-workbench-rail";

describe("session rail collapse defaults", () => {
  test("uses stored preference on wide viewports", () => {
    expect(resolveSessionRailCollapsedState("true", false)).toBe(true);
    expect(resolveSessionRailCollapsedState("false", false)).toBe(false);
  });

  test("forces the rail closed on narrow viewports", () => {
    expect(resolveSessionRailCollapsedState("true", true)).toBe(true);
    expect(resolveSessionRailCollapsedState("false", true)).toBe(true);
  });

  test("falls back to the current viewport when there is no stored preference", () => {
    expect(resolveSessionRailCollapsedState(null, true)).toBe(true);
    expect(resolveSessionRailCollapsedState(null, false)).toBe(false);
  });
});
