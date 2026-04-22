import { promises as fs } from "node:fs";
import path from "node:path";

import { DEFAULT_SESSION_WORKING_DIRECTORY } from "@ai-app-template/domain";

function isWithinRoot(rootDirectory: string, targetDirectory: string): boolean {
  const relativePath = path.relative(rootDirectory, targetDirectory);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

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

  const candidateDirectory = path.resolve(rootDirectory, input.trim());
  return isWithinRoot(rootDirectory, candidateDirectory)
    ? candidateDirectory
    : defaultDirectory;
}

export async function ensureApiWorkingDirectory(
  workspaceRoot: string
): Promise<string> {
  const directory = resolveApiWorkingDirectory(workspaceRoot);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}
