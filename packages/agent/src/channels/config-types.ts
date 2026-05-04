import { z } from "zod";

export const workspaceChannelConfigDiagnosticSchema = z.object({
  scope: z.enum(["file", "channel"]),
  code: z.enum(["invalid_toml", "invalid_root", "invalid_channel"]),
  message: z.string(),
  channelName: z.string().optional()
});

export type WorkspaceChannelConfigDiagnostic = z.infer<
  typeof workspaceChannelConfigDiagnosticSchema
>;

export const workspaceTelegramChannelConfigSchema = z.object({
  channel: z.literal("telegram"),
  configuredInFile: z.boolean(),
  enabled: z.boolean(),
  mode: z.enum(["polling", "webhook"]),
  botToken: z.string(),
  webhookSecret: z.string(),
  webhookUrl: z.string()
});

export type WorkspaceTelegramChannelConfig = z.infer<
  typeof workspaceTelegramChannelConfigSchema
>;

export const workspaceChannelConfigLoadResultSchema = z.object({
  configPath: z.string(),
  foundConfig: z.boolean(),
  telegram: workspaceTelegramChannelConfigSchema,
  diagnostics: z.array(workspaceChannelConfigDiagnosticSchema)
});

export type WorkspaceChannelConfigLoadResult = z.infer<
  typeof workspaceChannelConfigLoadResultSchema
>;
