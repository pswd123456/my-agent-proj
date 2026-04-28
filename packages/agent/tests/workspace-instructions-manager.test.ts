import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createWorkspaceInstructionsManager } from "../src/workspace-instructions/index.js";

async function createWorkspaceRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-workspace-instructions-"));
}

describe("WorkspaceInstructionsManager", () => {
  test("returns no instructions when root AGENTS.md is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      const result =
        await createWorkspaceInstructionsManager().load(workspaceRoot);

      expect(result.instructions).toBeNull();
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("loads the workspace root AGENTS.md content", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    try {
      await writeFile(
        path.join(workspaceRoot, "AGENTS.md"),
        "# AGENTS.md\n\n- Read scoped instructions before editing.\n",
        "utf8"
      );

      const result =
        await createWorkspaceInstructionsManager().load(workspaceRoot);

      expect(result.instructions).toEqual({
        relativePath: "AGENTS.md",
        content: "# AGENTS.md\n\n- Read scoped instructions before editing.\n"
      });
      expect(result.diagnostics).toEqual([]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
