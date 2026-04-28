import { describe, expect, test } from "bun:test";

import { createGetCurrentTimeTool } from "../src/tools/get-current-time.js";

describe("get_current_time tool", () => {
  test("returns current date, local datetime, timezone, and ISO timestamp", async () => {
    const tool = createGetCurrentTimeTool();

    expect(tool.name).toBe("get_current_time");
    expect(tool.isReadOnly).toBe(true);
    expect(tool.hasExternalSideEffect).toBe(false);
    expect(tool.validate({})).toEqual({ ok: true, value: {} });

    const result = await tool.execute({}, {} as never);
    const data = result.result.data as Record<string, unknown>;

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("CURRENT_TIME_READ");
    expect(data.current_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.current_local_datetime).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
    expect(typeof data.current_timezone).toBe("string");
    expect(typeof data.current_iso_datetime).toBe("string");
  });
});
