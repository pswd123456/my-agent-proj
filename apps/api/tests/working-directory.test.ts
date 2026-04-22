import { describe, expect, test } from "bun:test";

import path from "node:path";

import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

describe("resolveApiWorkingDirectory", () => {
  test("defaults to workspace root", () => {
    expect(resolveApiWorkingDirectory(workspaceRoot)).toBe(workspaceRoot);
  });

  test("keeps subdirectories inside the workspace root", () => {
    expect(resolveApiWorkingDirectory(workspaceRoot, "packages/agent")).toBe(
      path.join(workspaceRoot, "packages/agent")
    );
  });

  test("allows absolute paths that are still inside the workspace root", () => {
    const absoluteSubdirectory = path.join(workspaceRoot, "apps/api");
    expect(
      resolveApiWorkingDirectory(workspaceRoot, absoluteSubdirectory)
    ).toBe(absoluteSubdirectory);
  });

  test("clamps parent traversal back to workspace root", () => {
    expect(resolveApiWorkingDirectory(workspaceRoot, "../../")).toBe(
      workspaceRoot
    );
  });

  test("clamps absolute paths outside the workspace root", () => {
    expect(resolveApiWorkingDirectory(workspaceRoot, "/tmp")).toBe(
      workspaceRoot
    );
  });
});
