import { describe, expect, test } from "bun:test";

import {
  getDisplayStateToneClass,
  getSidebarStateBadgeClass
} from "./session-workbench-shared";

describe("sidebar state tone", () => {
  test("distinguishes active and warning treatments", () => {
    const activeText = getDisplayStateToneClass("active");
    const warningText = getDisplayStateToneClass("warning");
    const activeBadge = getSidebarStateBadgeClass("active");
    const warningBadge = getSidebarStateBadgeClass("warning");

    expect(activeText).not.toBe(warningText);
    expect(activeBadge).not.toBe(warningBadge);
    expect(activeBadge).toContain("app-border-accent");
    expect(warningBadge).toContain("app-status-warning");
  });
});
