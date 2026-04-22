import { describe, expect, test } from "bun:test";

import { isTimestampWithoutTimeZoneColumn } from "../src/schema.js";

describe("isTimestampWithoutTimeZoneColumn", () => {
  test("returns true for legacy timestamp columns", () => {
    expect(
      isTimestampWithoutTimeZoneColumn({
        data_type: "timestamp without time zone",
        udt_name: "timestamp"
      })
    ).toBe(true);
  });

  test("returns false for timestamptz columns", () => {
    expect(
      isTimestampWithoutTimeZoneColumn({
        data_type: "timestamp with time zone",
        udt_name: "timestamptz"
      })
    ).toBe(false);
  });
});
