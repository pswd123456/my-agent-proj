import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import {
  createDefaultToolRegistry,
  ToolRegistry,
  createWorkspaceToolRegistry
} from "../src/tools/registry.js";
import type { RuntimeTool } from "../src/tools/runtime-tool.js";

describe("ToolRegistry stage4 metadata contract", () => {
  test("registers the full workspace tool pack through one flat registry", () => {
    const registry = createWorkspaceToolRegistry({
      workingDirectory: "/tmp/workspace"
    });

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "apply_patch",
      "copy_path",
      "create_directory",
      "delete_path",
      "edit_file",
      "find_files",
      "git_diff",
      "git_diff_cached",
      "git_status",
      "list_directory",
      "make_http_request",
      "move_path",
      "read_file",
      "run_shell_command",
      "search_text",
      "write_file"
    ]);
  });

  test("mounts planning tools in the default runtime registry even without capability packs", () => {
    const registry = createDefaultToolRegistry({
      workingDirectory: "/tmp/workspace",
      routineRepository: createMemoryRoutineRepository(),
      enabledCapabilityPacks: []
    });

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "ask_user_question",
      "delegate_agent",
      "edit_task_brief",
      "get_task_brief",
      "get_todo_list",
      "manage_capability_packs",
      "read_task_brief",
      "replace_task_brief",
      "replace_todo_list",
      "search_task_brief",
      "update_todo_items"
    ]);
  });

  test("rejects destructive tools that skip permission inspection metadata", () => {
    const registry = new ToolRegistry();
    const badTool = {
      name: "bad_write",
      description: "Missing destructive permission inspection.",
      family: "workspace-file",
      isReadOnly: false,
      hasExternalSideEffect: true,
      permissionProfile: "destructive-only",
      sandboxProfile: "workspace-rooted",
      inputSchema: {},
      getSandboxTargets() {
        return ["foo.txt"];
      },
      validate() {
        return { ok: true, value: {} };
      },
      async execute() {
        throw new Error("not used");
      }
    } satisfies Omit<RuntimeTool, "getPermissionRequest">;

    expect(() => registry.register(badTool as RuntimeTool)).toThrow(
      /getPermissionRequest/
    );
  });
});
