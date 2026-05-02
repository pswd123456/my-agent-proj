import { describe, expect, test } from "bun:test";

import {
  createPostgresTestSessionManager,
  type PostgresTestSessionManager
} from "../../../tests/helpers/postgres-session-manager.js";
import {
  createManageCapabilityPacksTool,
  createPlanningToolRegistry
} from "../src/tools/index.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

async function createSessionContext(
  sessionManager: PostgresTestSessionManager,
  sessionId: string
): Promise<ToolExecutionContext> {
  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  return {
    sessionId: session.sessionId,
    userId: session.context.userId,
    workingDirectory: session.workingDirectory,
    routineRepository: undefined as never,
    sessionManager,
    sessionContext: {
      status: session.context.status,
      currentDateContext: session.context.currentDateContext,
      yoloMode: session.context.yoloMode,
      planModeEnabled: session.context.planModeEnabled,
      taskBriefPath: session.context.taskBriefPath,
      workspaceEscapeAllowed: session.context.workspaceEscapeAllowed,
      shellAllowPatterns: session.context.shellAllowPatterns,
      shellDenyPatterns: session.context.shellDenyPatterns,
      toolAllowList: session.context.toolAllowList,
      toolAskList: session.context.toolAskList,
      toolDenyList: session.context.toolDenyList,
      todoState: session.context.todoState ?? null
    },
    permissionRules: {
      shellAllowPatterns: session.context.shellAllowPatterns,
      shellDenyPatterns: session.context.shellDenyPatterns,
      toolAllowList: session.context.toolAllowList,
      toolAskList: session.context.toolAskList,
      toolDenyList: session.context.toolDenyList
    },
    sessionMessages: session.messages
  };
}

describe("manage_capability_packs tool", () => {
  test("lists the current capability pack state", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "pack-user",
      enabledCapabilityPacks: ["workspace"]
    });

    const result = await createManageCapabilityPacksTool().execute(
      { action: "list" },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("CAPABILITY_PACKS_LISTED");
    expect(result.displayText).toContain("- action: list");
    expect(result.displayText).toContain(
      "- available: workspace, schedule, lsp"
    );
    expect(result.displayText).toContain("- workspace: enabled");
    expect(result.displayText).toContain("- schedule: disabled");
    expect(result.displayText).toContain("- lsp: disabled");
    expect(result.content).toContain('"effectiveFromNextRun": false');
  });

  test("enables and disables packs with idempotent updates", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "pack-user",
      enabledCapabilityPacks: ["workspace"]
    });
    const tool = createManageCapabilityPacksTool();

    const enableResult = await tool.execute(
      { action: "enable", pack_name: "schedule" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(enableResult.state).toBe("success");
    expect(enableResult.result.code).toBe("CAPABILITY_PACK_ENABLED");
    expect(enableResult.displayText).toContain("effective: next run");
    expect(enableResult.displayText).toContain(
      "- enabled: workspace, schedule"
    );

    const enabledSession = await sessionManager.getSession(session.sessionId);
    expect(enabledSession?.context.enabledCapabilityPacks).toEqual([
      "workspace",
      "schedule"
    ]);

    const duplicateEnableResult = await tool.execute(
      { action: "enable", pack_name: "schedule" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(duplicateEnableResult.state).toBe("success");
    expect(duplicateEnableResult.result.code).toBe(
      "CAPABILITY_PACK_ALREADY_ENABLED"
    );
    expect(duplicateEnableResult.displayText).toContain("(unchanged)");

    const disableResult = await tool.execute(
      { action: "disable", pack_name: "workspace" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(disableResult.state).toBe("success");
    expect(disableResult.result.code).toBe("CAPABILITY_PACK_DISABLED");
    expect(disableResult.displayText).toContain("- enabled: schedule");

    const disabledSession = await sessionManager.getSession(session.sessionId);
    expect(disabledSession?.context.enabledCapabilityPacks).toEqual([
      "schedule"
    ]);

    const duplicateDisableResult = await tool.execute(
      { action: "disable", pack_name: "workspace" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(duplicateDisableResult.state).toBe("success");
    expect(duplicateDisableResult.result.code).toBe(
      "CAPABILITY_PACK_ALREADY_DISABLED"
    );
    expect(duplicateDisableResult.displayText).toContain("(unchanged)");
  });

  test("rejects unknown packs", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "pack-user"
    });

    const result = await createManageCapabilityPacksTool().execute(
      { action: "enable", pack_name: "unknown" as never },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
    expect(result.displayText).toContain(
      "[manage_capability_packs] invalid input"
    );
  });

  test("returns structured validation errors for missing pack_name", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "pack-user"
    });

    const result = await createManageCapabilityPacksTool().execute(
      { action: "enable" } as never,
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
    expect(result.displayText).toContain(
      "[manage_capability_packs] invalid input"
    );
    expect(result.result.validationErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "pack_name"
        })
      ])
    );
  });

  test("can enable the lsp capability pack", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "pack-user",
      enabledCapabilityPacks: ["workspace"]
    });

    const result = await createManageCapabilityPacksTool().execute(
      { action: "enable", pack_name: "lsp" },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("CAPABILITY_PACK_ENABLED");
    expect(result.displayText).toContain("- lsp: enabled");

    const updatedSession = await sessionManager.getSession(session.sessionId);
    expect(updatedSession?.context.enabledCapabilityPacks).toEqual([
      "workspace",
      "lsp"
    ]);
  });

  test("is mounted in the planning registry by default", () => {
    const registry = createPlanningToolRegistry();
    expect(registry.list().map((tool) => tool.name)).toContain(
      "manage_capability_packs"
    );
  });
});
