import path from "node:path";

export const WORKSPACE_AGENT_CONFIG_DIRECTORY = ".agents";
export const WORKSPACE_AGENT_CONFIG_FILE_NAME = "config.toml";

export function getWorkspaceAgentConfigPath(workingDirectory: string): string {
  return path.join(
    path.resolve(workingDirectory),
    WORKSPACE_AGENT_CONFIG_DIRECTORY,
    WORKSPACE_AGENT_CONFIG_FILE_NAME
  );
}
