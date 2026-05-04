import { describe, expect, test } from "bun:test";

import { PERMISSION_TOOL_OPTIONS } from "@ai-app-template/domain";

import {
  createDefaultToolRegistry,
  listSettingsPermissionToolOptions,
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
      "create_directory",
      "delete_file",
      "delete_path",
      "find_files",
      "git_diff",
      "git_status",
      "list_directory",
      "load_skill",
      "make_http_request",
      "manage_path",
      "read_file",
      "run_shell_command",
      "search_skill",
      "search_text",
      "write_file"
    ]);
  });

  test("mounts planning tools in the default runtime registry even without capability packs", () => {
    const registry = createDefaultToolRegistry({
      workingDirectory: "/tmp/workspace",
      enabledCapabilityPacks: []
    });

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "ask_user_question",
      "delegate_agent",
      "get_current_time",
      "manage_capability_packs",
      "manage_task_brief",
      "manage_todo_list"
    ]);
  });

  test("mounts lsp tools only when the lsp capability pack is enabled", () => {
    const enabledRegistry = createDefaultToolRegistry({
      workingDirectory: "/tmp/workspace",
      enabledCapabilityPacks: ["lsp"]
    });

    expect(enabledRegistry.list().map((tool) => tool.name)).toEqual([
      "ask_user_question",
      "delegate_agent",
      "get_current_time",
      "lsp_diagnostics",
      "lsp_document_symbols",
      "lsp_find_references",
      "lsp_go_to_definition",
      "lsp_hover",
      "lsp_workspace_symbols",
      "manage_capability_packs",
      "manage_task_brief",
      "manage_todo_list"
    ]);

    const disabledRegistry = createDefaultToolRegistry({
      workingDirectory: "/tmp/workspace",
      enabledCapabilityPacks: ["workspace", "schedule"]
    });

    expect(disabledRegistry.get("lsp_hover")).toBeUndefined();
  });

  test("keeps the settings permission list aligned with built-in tools", () => {
    const registry = createDefaultToolRegistry({
      workingDirectory: "/tmp/workspace"
    });

    expect([...PERMISSION_TOOL_OPTIONS].sort()).toEqual(
      registry.list().map((tool) => tool.name)
    );
  });

  test("all built-in tool descriptions follow the four-section instruction format", () => {
    const registry = createDefaultToolRegistry({
      workingDirectory: "/tmp/workspace",
      enabledCapabilityPacks: ["workspace", "schedule", "lsp"]
    });

    for (const tool of registry.list()) {
      expect(tool.description).toContain("1. Usage scenarios / goals");
      expect(tool.description).toContain("2. Usage instructions");
      expect(tool.description).toContain("3. Constraints / cautions");
      expect(tool.description).toContain("4. Few-shot examples (Examples:)");
    }
  });

  test("derives settings permission tools from the runtime registry surface", () => {
    const options = listSettingsPermissionToolOptions({
      workingDirectory: "/tmp/workspace"
    });

    expect(options.map((tool) => tool.name)).toEqual(
      registryNamesWithoutShellOrNetwork()
    );
    expect(options.find((tool) => tool.name === "read_file")).toEqual({
      name: "read_file",
      family: "workspace-file",
      capabilityPack: "workspace"
    });
    expect(options.find((tool) => tool.name === "manage_routine")).toEqual({
      name: "manage_routine",
      family: "schedule",
      capabilityPack: "schedule"
    });
    expect(options.find((tool) => tool.name === "manage_cron_jobs")).toEqual({
      name: "manage_cron_jobs",
      family: "schedule",
      capabilityPack: "schedule"
    });
    expect(options.find((tool) => tool.name === "delegate_agent")).toEqual({
      name: "delegate_agent",
      family: "delegation",
      capabilityPack: null
    });
    expect(options.find((tool) => tool.name === "lsp_hover")).toEqual({
      name: "lsp_hover",
      family: "lsp",
      capabilityPack: "lsp"
    });
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

function registryNamesWithoutShellOrNetwork(): string[] {
  return createDefaultToolRegistry({
    workingDirectory: "/tmp/workspace"
  })
    .list()
    .filter(
      (tool) =>
        tool.family !== "workspace-shell" && tool.family !== "workspace-network"
    )
    .map((tool) => tool.name);
}
