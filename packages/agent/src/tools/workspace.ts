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

export class WorkspaceSandboxError extends Error {
  constructor(message = "Path escapes the working directory.") {
    super(message);
    this.name = "WorkspaceSandboxError";
  }
}

export function normalizeWorkspacePath(
  workingDirectory: string,
  targetPath: string,
  allowEscape = false
): string {
  const baseDirectory = path.resolve(workingDirectory);
  const resolvedPath = path.resolve(baseDirectory, targetPath);
  if (allowEscape) {
    return resolvedPath;
  }
  const relativePath = path.relative(baseDirectory, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new WorkspaceSandboxError();
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

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function getPathKind(
  targetPath: string
): Promise<"file" | "directory" | "missing"> {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      return "directory";
    }
    if (stat.isFile()) {
      return "file";
    }
    return "missing";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
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

export function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  return `${value.slice(0, maxCharacters)}\n...[truncated]`;
}
