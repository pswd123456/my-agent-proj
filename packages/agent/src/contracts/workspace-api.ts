import { z } from "zod";

import {
  workspaceMcpConfigDiagnosticSchema,
  workspaceMcpServerConfigSchema,
  workspaceMcpServerLoadSummarySchema
} from "../mcp/config-types.js";
import { workspaceFileChangeSummarySchema } from "../types.js";

const workspaceMcpStringRecordSchema = z.record(z.string(), z.string());

export const workspaceSearchQuerySchema = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export type WorkspaceSearchQuery = z.infer<typeof workspaceSearchQuerySchema>;

export const workspaceFileSearchItemSchema = z.object({
  path: z.string(),
  name: z.string()
});

export type WorkspaceFileSearchItem = z.infer<
  typeof workspaceFileSearchItemSchema
>;

export const workspaceFileSearchResultSchema = z.object({
  items: z.array(workspaceFileSearchItemSchema),
  truncated: z.boolean()
});

export type WorkspaceFileSearchResult = z.infer<
  typeof workspaceFileSearchResultSchema
>;

export const workspaceSkillSearchItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  relativePath: z.string()
});

export type WorkspaceSkillSearchItem = z.infer<
  typeof workspaceSkillSearchItemSchema
>;

export const workspaceSkillSearchResultSchema = z.object({
  items: z.array(workspaceSkillSearchItemSchema),
  truncated: z.boolean()
});

export type WorkspaceSkillSearchResult = z.infer<
  typeof workspaceSkillSearchResultSchema
>;

export const sessionWorkspaceGitStatusCodeSchema = z.enum([
  "GIT_STATUS_OK",
  "GIT_NOT_AVAILABLE",
  "NOT_GIT_REPOSITORY",
  "GIT_STATUS_FAILED"
]);

export type SessionWorkspaceGitStatusCode = z.infer<
  typeof sessionWorkspaceGitStatusCodeSchema
>;

export const sessionWorkspaceGitStatusSchema = z.object({
  workingDirectory: z.string(),
  ok: z.boolean(),
  code: sessionWorkspaceGitStatusCodeSchema,
  message: z.string(),
  branch: z.string().nullable(),
  clean: z.boolean().nullable(),
  changedPathCount: z.number().int().min(0),
  stagedPathCount: z.number().int().min(0),
  unstagedPathCount: z.number().int().min(0),
  untrackedPathCount: z.number().int().min(0),
  addedLineCount: z.number().int().min(0),
  removedLineCount: z.number().int().min(0)
});

export type SessionWorkspaceGitStatus = z.infer<
  typeof sessionWorkspaceGitStatusSchema
>;

export const userSettingsMcpPayloadSchema = z.object({
  workingDirectory: z.string(),
  configPath: z.string(),
  foundConfig: z.boolean(),
  servers: z.array(workspaceMcpServerConfigSchema),
  serverStatuses: z.array(workspaceMcpServerLoadSummarySchema),
  diagnostics: z.array(workspaceMcpConfigDiagnosticSchema)
});

export type UserSettingsMcpPayload = z.infer<
  typeof userSettingsMcpPayloadSchema
>;

export const updateUserSettingsMcpServerSchema = z.discriminatedUnion(
  "transport",
  [
    z.object({
      name: z.string().trim().min(1),
      transport: z.literal("stdio"),
      enabled: z.boolean().optional(),
      disabledTools: z.array(z.string()).optional(),
      command: z.string().trim().min(1),
      args: z.array(z.string()).optional(),
      env: workspaceMcpStringRecordSchema.optional()
    }),
    z.object({
      name: z.string().trim().min(1),
      transport: z.literal("http"),
      enabled: z.boolean().optional(),
      disabledTools: z.array(z.string()).optional(),
      url: z.string().trim().url(),
      headers: workspaceMcpStringRecordSchema.optional()
    })
  ]
);

export type UpdateUserSettingsMcpServer = z.infer<
  typeof updateUserSettingsMcpServerSchema
>;

export const updateUserSettingsMcpPayloadSchema = z.object({
  servers: z.array(updateUserSettingsMcpServerSchema)
});

export type UpdateUserSettingsMcpPayload = z.infer<
  typeof updateUserSettingsMcpPayloadSchema
>;

export const sessionFileChangeActionSchema = z.enum(["undo", "reapply"]);

export type SessionFileChangeAction = z.infer<
  typeof sessionFileChangeActionSchema
>;

export const sessionFileChangeActionRequestSchema = z.object({
  action: sessionFileChangeActionSchema,
  files: z.array(workspaceFileChangeSummarySchema).min(1)
});

export type SessionFileChangeActionRequest = z.infer<
  typeof sessionFileChangeActionRequestSchema
>;

export const sessionFileChangeActionResultSchema = z.object({
  sessionId: z.string(),
  action: sessionFileChangeActionSchema,
  files: z.array(workspaceFileChangeSummarySchema)
});

export type SessionFileChangeActionResult = z.infer<
  typeof sessionFileChangeActionResultSchema
>;
