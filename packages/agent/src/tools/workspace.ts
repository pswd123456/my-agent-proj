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

export type WorkspaceSandboxTargetClassification =
  | "inside_workspace"
  | "outside_workspace"
  | "symlink_escape";

export interface WorkspaceSandboxTargetPreflight {
  requestedPath: string;
  resolvedPath: string;
  existingPath: string | null;
  realPath: string | null;
  classification: WorkspaceSandboxTargetClassification;
}

export interface WorkspaceSandboxPreflightResult {
  targets: WorkspaceSandboxTargetPreflight[];
  outsideTargets: WorkspaceSandboxTargetPreflight[];
  symlinkEscapeTargets: WorkspaceSandboxTargetPreflight[];
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const relativePath = path.relative(basePath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

async function pathExistsForSandbox(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function findNearestExistingPath(targetPath: string): Promise<string> {
  let currentPath = targetPath;

  while (!(await pathExistsForSandbox(currentPath))) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return currentPath;
    }
    currentPath = parentPath;
  }

  return currentPath;
}

async function safeRealpath(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "EINVAL"
    ) {
      return null;
    }
    throw error;
  }
}

export async function preflightWorkspaceSandboxTargets(input: {
  workingDirectory: string;
  targets: string[];
}): Promise<WorkspaceSandboxPreflightResult> {
  const workspaceRoot = path.resolve(input.workingDirectory);
  const workspaceRootRealPath =
    (await safeRealpath(workspaceRoot)) ?? workspaceRoot;
  const requestedTargets = input.targets.length > 0 ? input.targets : ["."];
  const targets: WorkspaceSandboxTargetPreflight[] = [];

  for (const rawTarget of requestedTargets) {
    const requestedPath = rawTarget.length > 0 ? rawTarget : ".";
    const resolvedPath = path.resolve(workspaceRoot, requestedPath);
    const lexicalInsideWorkspace = isPathInside(workspaceRoot, resolvedPath);
    const existingPath = await findNearestExistingPath(resolvedPath);
    const realPath = await safeRealpath(existingPath);

    let classification: WorkspaceSandboxTargetClassification =
      "inside_workspace";
    if (!lexicalInsideWorkspace) {
      classification = "outside_workspace";
    } else if (
      realPath &&
      !isPathInside(workspaceRootRealPath, realPath)
    ) {
      classification = "symlink_escape";
    }

    targets.push({
      requestedPath,
      resolvedPath,
      existingPath,
      realPath,
      classification
    });
  }

  return {
    targets,
    outsideTargets: targets.filter(
      (target) => target.classification === "outside_workspace"
    ),
    symlinkEscapeTargets: targets.filter(
      (target) => target.classification === "symlink_escape"
    )
  };
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
  if (!isPathInside(baseDirectory, resolvedPath)) {
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
