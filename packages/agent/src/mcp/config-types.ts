export type WorkspaceMcpTransportKind = "stdio" | "http";

export interface WorkspaceMcpConfigDiagnostic {
  scope: "file" | "server";
  code:
    | "invalid_toml"
    | "invalid_root"
    | "duplicate_server"
    | "invalid_server"
    | "invalid_field";
  message: string;
  serverName?: string;
}

export interface WorkspaceMcpStdioServerConfig {
  name: string;
  transport: "stdio";
  enabled: boolean;
  disabledTools: string[];
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface WorkspaceMcpHttpServerConfig {
  name: string;
  transport: "http";
  enabled: boolean;
  disabledTools: string[];
  url: string;
  headers: Record<string, string>;
}

export type WorkspaceMcpServerConfig =
  | WorkspaceMcpStdioServerConfig
  | WorkspaceMcpHttpServerConfig;

export interface WorkspaceMcpConfigLoadResult {
  configPath: string;
  foundConfig: boolean;
  servers: WorkspaceMcpServerConfig[];
  diagnostics: WorkspaceMcpConfigDiagnostic[];
}

export interface WorkspaceMcpServerLoadSummary {
  name: string;
  transport: WorkspaceMcpTransportKind;
  status: "loaded" | "failed" | "disabled";
  toolNames: string[];
  tools?: WorkspaceMcpToolLoadSummary[];
  error?: string;
}

export interface WorkspaceMcpToolLoadSummary {
  name: string;
  runtimeName: string;
  description: string | null;
  enabled: boolean;
}

export interface WorkspaceMcpLoadResult {
  configPath: string;
  foundConfig: boolean;
  diagnostics: WorkspaceMcpConfigDiagnostic[];
  servers: WorkspaceMcpServerLoadSummary[];
  tools: import("../tools/runtime-tool.js").RuntimeTool[];
  dispose(): Promise<void>;
}
