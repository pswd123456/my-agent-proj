import { describe, expect, test } from "bun:test";

import { clearActiveSidebarPanel } from "./session-workbench-types";

describe("conversation view focus", () => {
  test("clears active sidebar panel when returning to chat", () => {
    expect(clearActiveSidebarPanel()).toBeNull();
  });
});
