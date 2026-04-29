import { promises as fs } from "node:fs";
import path from "node:path";

import { DEFAULT_SESSION_WORKING_DIRECTORY } from "@ai-app-template/domain";

export function resolveApiWorkingDirectory(
  workspaceRoot: string,
  input?: string
): string {
  const rootDirectory = path.resolve(workspaceRoot);
  const defaultDirectory = path.resolve(
    rootDirectory,
    DEFAULT_SESSION_WORKING_DIRECTORY
  );
  if (!input?.trim()) {
    return defaultDirectory;
  }

  return path.resolve(rootDirectory, input.trim());
}

export async function ensureApiWorkingDirectory(
  workspaceRoot: string
): Promise<string> {
  const directory = resolveApiWorkingDirectory(workspaceRoot);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}
