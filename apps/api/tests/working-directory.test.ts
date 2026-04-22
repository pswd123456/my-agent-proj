import { describe, expect, test } from "bun:test";

import path from "node:path";

import { DEFAULT_SESSION_WORKING_DIRECTORY } from "@ai-app-template/domain";

import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";
const defaultWorkspace = path.join(
  workspaceRoot,
  DEFAULT_SESSION_WORKING_DIRECTORY
);

describe("resolveApiWorkingDirectory", () => {
  test("defaults to agent-workspace under the repo root", () => {
    expect(resolveApiWorkingDirectory(workspaceRoot)).toBe(defaultWorkspace);
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
      defaultWorkspace
    );
  });

  test("clamps absolute paths outside the workspace root", () => {
    expect(resolveApiWorkingDirectory(workspaceRoot, "/tmp")).toBe(
      defaultWorkspace
    );
  });
});
