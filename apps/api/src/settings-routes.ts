import { z } from "zod";

import {
  normalizeWorkspaceMcpServerConfigs,
  replaceWorkspaceMcpConfigServers,
  updateUserSettingsChannelsPayloadSchema,
  updateUserSettingsMcpPayloadSchema
} from "@ai-app-template/agent";
import {
  normalizeThinkingEffort,
  updateUserSettingsPayloadSchema
} from "@ai-app-template/domain";

import type { ApiApp, ApiAppDependencies } from "./app-context.js";
import {
  buildUserSettingsChannelsPayload,
  buildUserSettingsMcpPayload,
  buildUserSettingsSkillsPayload,
  hasDuplicateMcpServerNames,
  resolveRequestedModel
} from "./app-shared.js";

export function registerSettingsRoutes(input: {
  app: ApiApp;
  dependencies: ApiAppDependencies;
  settingsPermissionTools: unknown;
}) {
  const { app, dependencies, settingsPermissionTools } = input;

  app.get("/settings", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json({ settings, permissionTools: settingsPermissionTools });
  });

  app.get("/settings/channels", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json(
      await buildUserSettingsChannelsPayload(settings.workingDirectory)
    );
  });

  app.put("/settings/channels", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    const body = updateUserSettingsChannelsPayloadSchema.parse(
      await c.req.json()
    );
    await dependencies.settingsConfigStore.updateWorkspaceChannels(
      settings.workingDirectory,
      {
        enabled: body.telegram.enabled,
        mode: body.telegram.mode,
        botToken: body.telegram.botToken.trim(),
        webhookSecret: body.telegram.webhookSecret.trim(),
        webhookUrl: body.telegram.webhookUrl.trim()
      }
    );
    return c.json(
      await buildUserSettingsChannelsPayload(settings.workingDirectory)
    );
  });

  app.get("/settings/mcp", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json(await buildUserSettingsMcpPayload(settings.workingDirectory));
  });

  app.put("/settings/mcp", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    const body = updateUserSettingsMcpPayloadSchema.parse(await c.req.json());
    if (hasDuplicateMcpServerNames(body.servers)) {
      return c.json({ error: "MCP server names must be unique." }, 400);
    }

    const servers: Parameters<typeof replaceWorkspaceMcpConfigServers>[1] =
      normalizeWorkspaceMcpServerConfigs(
        body.servers as Parameters<typeof normalizeWorkspaceMcpServerConfigs>[0]
      );
    await dependencies.settingsConfigStore.updateWorkspaceMcpServers(
      settings.workingDirectory,
      servers
    );
    return c.json(await buildUserSettingsMcpPayload(settings.workingDirectory));
  });

  app.get("/settings/skills", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json(
      await buildUserSettingsSkillsPayload(
        settings.workingDirectory,
        settings.workspaceSkillSettings
      )
    );
  });

  app.patch("/settings", async (c) => {
    const body = updateUserSettingsPayloadSchema.parse(await c.req.json());
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const settings = await dependencies.settingsConfigStore.updateGlobalSettings({
      ...(typeof body.workingDirectory === "string"
        ? {
            workingDirectory: dependencies.buildWorkingDirectory(
              body.workingDirectory
            )
          }
        : {}),
      ...(requestedModel.model ? { model: requestedModel.model } : {}),
      ...(typeof body.thinkingEffort === "string"
        ? { thinkingEffort: normalizeThinkingEffort(body.thinkingEffort) }
        : {}),
      ...(typeof body.yoloMode === "boolean"
        ? { yoloMode: body.yoloMode }
        : {}),
      ...(typeof body.contextWindow === "number"
        ? { contextWindow: body.contextWindow }
        : {}),
      ...(typeof body.maxTurns === "number" ? { maxTurns: body.maxTurns } : {}),
      ...(Array.isArray(body.shellAllowPatterns)
        ? { shellAllowPatterns: body.shellAllowPatterns }
        : {}),
      ...(Array.isArray(body.shellDenyPatterns)
        ? { shellDenyPatterns: body.shellDenyPatterns }
        : {}),
      ...(Array.isArray(body.toolAllowList)
        ? { toolAllowList: body.toolAllowList }
        : {}),
      ...(Array.isArray(body.toolAskList)
        ? { toolAskList: body.toolAskList }
        : {}),
      ...(Array.isArray(body.toolDenyList)
        ? { toolDenyList: body.toolDenyList }
        : {}),
      ...(Array.isArray(body.enabledCapabilityPacks)
        ? { enabledCapabilityPacks: body.enabledCapabilityPacks }
        : {}),
      ...(Array.isArray(body.workspaceSkillSettings)
        ? { workspaceSkillSettings: body.workspaceSkillSettings }
        : {}),
      ...(Array.isArray(body.userContextHooks)
        ? { userContextHooks: body.userContextHooks }
        : {}),
      ...(typeof body.debugConversationView === "boolean"
        ? { debugConversationView: body.debugConversationView }
        : {}),
      ...(typeof body.userCustomPrompt === "string"
        ? { userCustomPrompt: body.userCustomPrompt }
        : {})
    });
    return c.json({ settings, permissionTools: settingsPermissionTools });
  });
}
