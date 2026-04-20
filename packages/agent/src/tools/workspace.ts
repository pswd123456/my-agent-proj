import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "dist",
  "node_modules",
  "coverage"
]);

export function normalizeWorkspacePath(
  workingDirectory: string,
  targetPath: string
): string {
  const baseDirectory = path.resolve(workingDirectory);
  const resolvedPath = path.resolve(baseDirectory, targetPath);
  const relativePath = path.relative(baseDirectory, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Path escapes the working directory.");
  }

  return resolvedPath;
}

export function toRelativeWorkspacePath(
  workingDirectory: string,
  targetPath: string
): string {
  return path
    .relative(path.resolve(workingDirectory), path.resolve(targetPath))
    .replaceAll(path.sep, "/");
}

export async function readTextFileWithLimit(
  filePath: string,
  maxCharacters: number
): Promise<{ text: string; truncated: boolean }> {
  const text = await fs.readFile(filePath, "utf8");

  if (text.length <= maxCharacters) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, maxCharacters),
    truncated: true
  };
}

function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

export async function walkFiles(
  rootDirectory: string,
  maxFiles: number
): Promise<string[]> {
  const collectedFiles: string[] = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0 && collectedFiles.length < maxFiles) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    const entries = await fs.readdir(currentDirectory, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) {
          pendingDirectories.push(entryPath);
        }
        continue;
      }

      if (entry.isFile()) {
        collectedFiles.push(entryPath);
        if (collectedFiles.length >= maxFiles) {
          break;
        }
      }
    }
  }

  return collectedFiles;
}

export function buildJsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
