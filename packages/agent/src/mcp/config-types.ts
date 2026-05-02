import { z } from "zod";

export const workspaceMcpTransportKindSchema = z.enum(["stdio", "http"]);

export type WorkspaceMcpTransportKind = z.infer<
  typeof workspaceMcpTransportKindSchema
>;

export const workspaceMcpConfigDiagnosticSchema = z.object({
  scope: z.enum(["file", "server"]),
  code: z.enum([
    "invalid_toml",
    "invalid_root",
    "duplicate_server",
    "invalid_server",
    "invalid_field"
  ]),
  message: z.string(),
  serverName: z.string().optional()
});

export type WorkspaceMcpConfigDiagnostic = z.infer<
  typeof workspaceMcpConfigDiagnosticSchema
>;

const workspaceMcpStringRecordSchema = z.record(z.string(), z.string());

export const workspaceMcpStdioServerConfigSchema = z.object({
  name: z.string().trim().min(1),
  transport: z.literal("stdio"),
  enabled: z.boolean(),
  disabledTools: z.array(z.string()),
  command: z.string().trim().min(1),
  args: z.array(z.string()),
  env: workspaceMcpStringRecordSchema
});

export type WorkspaceMcpStdioServerConfig = z.infer<
  typeof workspaceMcpStdioServerConfigSchema
>;

export const workspaceMcpHttpServerConfigSchema = z.object({
  name: z.string().trim().min(1),
  transport: z.literal("http"),
  enabled: z.boolean(),
  disabledTools: z.array(z.string()),
  url: z.string().trim().url(),
  headers: workspaceMcpStringRecordSchema
});

export type WorkspaceMcpHttpServerConfig = z.infer<
  typeof workspaceMcpHttpServerConfigSchema
>;

export const workspaceMcpServerConfigSchema = z.discriminatedUnion(
  "transport",
  [workspaceMcpStdioServerConfigSchema, workspaceMcpHttpServerConfigSchema]
);

export type WorkspaceMcpServerConfig = z.infer<
  typeof workspaceMcpServerConfigSchema
>;

export const workspaceMcpConfigLoadResultSchema = z.object({
  configPath: z.string(),
  foundConfig: z.boolean(),
  servers: z.array(workspaceMcpServerConfigSchema),
  diagnostics: z.array(workspaceMcpConfigDiagnosticSchema)
});

export type WorkspaceMcpConfigLoadResult = z.infer<
  typeof workspaceMcpConfigLoadResultSchema
>;

export const workspaceMcpToolLoadSummarySchema = z.object({
  name: z.string(),
  runtimeName: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean()
});

export type WorkspaceMcpToolLoadSummary = z.infer<
  typeof workspaceMcpToolLoadSummarySchema
>;

export const workspaceMcpServerLoadSummarySchema = z.object({
  name: z.string(),
  transport: workspaceMcpTransportKindSchema,
  status: z.enum(["loaded", "failed", "disabled"]),
  toolNames: z.array(z.string()),
  tools: z.array(workspaceMcpToolLoadSummarySchema).optional(),
  error: z.string().optional()
});

export type WorkspaceMcpServerLoadSummary = z.infer<
  typeof workspaceMcpServerLoadSummarySchema
>;

export interface WorkspaceMcpLoadResult {
  configPath: string;
  foundConfig: boolean;
  diagnostics: WorkspaceMcpConfigDiagnostic[];
  servers: WorkspaceMcpServerLoadSummary[];
  tools: import("../tools/runtime-tool.js").RuntimeTool[];
  dispose(): Promise<void>;
}
