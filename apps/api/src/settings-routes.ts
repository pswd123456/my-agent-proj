import { z } from "zod";

import {
  normalizeWorkspaceMcpServerConfigs,
  replaceWorkspaceMcpConfigServers,
  updateUserSettingsChannelsPayloadSchema,
  updateUserSettingsMcpPayloadSchema
} from "@ai-app-template/agent";
import {
  normalizeThinkingEffort,
  pickDefinedSettingsFields,
  updateUserSettingsFieldNames,
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
      await buildUserSettingsChannelsPayload(
        settings.workingDirectory,
        dependencies.inboxBindingRepository
      )
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
      await buildUserSettingsChannelsPayload(
        settings.workingDirectory,
        dependencies.inboxBindingRepository
      )
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
    const patch = pickDefinedSettingsFields(body, updateUserSettingsFieldNames);
    if (typeof body.workingDirectory === "string") {
      patch.workingDirectory = dependencies.buildWorkingDirectory(
        body.workingDirectory
      );
    }
    if (requestedModel.model) {
      patch.model = requestedModel.model;
    } else {
      delete patch.model;
    }
    if (typeof body.thinkingEffort === "string") {
      patch.thinkingEffort = normalizeThinkingEffort(body.thinkingEffort);
    }
    const settings =
      await dependencies.settingsConfigStore.updateGlobalSettings(patch);
    return c.json({ settings, permissionTools: settingsPermissionTools });
  });
}
