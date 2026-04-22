import { describe, expect, test } from "bun:test";

import { toIsoString } from "../src/session/postgres-session-manager.js";

describe("toIsoString", () => {
  test("preserves timestamps that already include a timezone", () => {
    expect(toIsoString("2026-04-21T18:45:18.392Z")).toBe(
      "2026-04-21T18:45:18.392Z"
    );
  });

  test("treats SQL timestamps without timezone as UTC", () => {
    expect(toIsoString("2026-04-21 18:45:18.392")).toBe(
      "2026-04-21T18:45:18.392Z"
    );
  });
});
