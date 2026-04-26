import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ConversationBlock, JsonValue } from "../types.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "dist",
  "node_modules",
  "coverage"
]);
const RECENT_WORKSPACE_ACTIVITY_WINDOW = 18;
const REPEATED_ACTIVITY_WARN_THRESHOLD = 2;
const REPEATED_ACTIVITY_BLOCK_THRESHOLD = 4;

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

export interface RepeatedWorkspaceActivityAssessment {
  repeatCount: number;
  shouldWarn: boolean;
  shouldBlock: boolean;
}

export interface NormalizedReadFileActivityIdentity {
  path: string;
  offset: number;
  limit: number | null;
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

export async function writeTextFileAtomic(
  targetPath: string,
  content: string,
  options: {
    mode?: number;
  } = {}
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${randomUUID()}`
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;

  try {
    handle = await fs.open(temporaryPath, "wx", options.mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore close errors while cleaning up a failed atomic write
      }
    }

    try {
      await fs.rm(temporaryPath, { force: true });
    } catch {
      // ignore temp cleanup failures after a failed atomic write
    }

    throw error;
  }
}

function normalizeRepeatPath(
  workingDirectory: string,
  rawPath: unknown
): string {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return ".";
  }

  return toRelativeWorkspacePath(
    workingDirectory,
    path.resolve(workingDirectory, rawPath)
  );
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export function normalizeReadFileActivityIdentity(input: {
  toolInput: Record<string, JsonValue>;
  workingDirectory: string;
}): NormalizedReadFileActivityIdentity {
  const startLine = normalizePositiveInteger(input.toolInput.startLine);
  const endLine = normalizePositiveInteger(input.toolInput.endLine);
  const offset = normalizeNonNegativeInteger(input.toolInput.offset);
  const limit = normalizePositiveInteger(input.toolInput.limit);

  if (offset !== null || limit !== null) {
    return {
      path: normalizeRepeatPath(input.workingDirectory, input.toolInput.path),
      offset: offset ?? 0,
      limit
    };
  }

  const normalizedStartLine = startLine ?? 1;
  return {
    path: normalizeRepeatPath(input.workingDirectory, input.toolInput.path),
    offset: normalizedStartLine - 1,
    limit:
      endLine === null ? null : endLine - normalizedStartLine + 1
  };
}

function buildRepeatedActivityFingerprint(input: {
  toolName: "read_file" | "search_text";
  toolInput: Record<string, JsonValue>;
  workingDirectory: string;
}): string {
  if (input.toolName === "read_file") {
    return JSON.stringify({
      toolName: input.toolName,
      ...normalizeReadFileActivityIdentity({
        toolInput: input.toolInput,
        workingDirectory: input.workingDirectory
      })
    });
  }

  return JSON.stringify({
    toolName: input.toolName,
    query:
      typeof input.toolInput.query === "string"
        ? input.toolInput.query.trim()
        : "",
    path: normalizeRepeatPath(input.workingDirectory, input.toolInput.path),
    regex: input.toolInput.regex === true,
    caseSensitive:
      typeof input.toolInput.caseSensitive === "boolean"
        ? input.toolInput.caseSensitive
        : true,
    fileGlob:
      typeof input.toolInput.fileGlob === "string"
        ? input.toolInput.fileGlob.trim()
        : "",
    outputMode:
      typeof input.toolInput.outputMode === "string"
        ? input.toolInput.outputMode
        : "content"
  });
}

export function assessRepeatedWorkspaceActivity(input: {
  toolName: "read_file" | "search_text";
  toolInput: Record<string, JsonValue>;
  workingDirectory: string;
  sessionMessages: ConversationBlock[];
}): RepeatedWorkspaceActivityAssessment {
  const fingerprint = buildRepeatedActivityFingerprint(input);
  const recentBlocks = input.sessionMessages.slice(
    -RECENT_WORKSPACE_ACTIVITY_WINDOW
  );

  let recentWindowStart = 0;
  for (let index = recentBlocks.length - 1; index >= 0; index -= 1) {
    if (recentBlocks[index]?.kind === "user") {
      recentWindowStart = index + 1;
      break;
    }
  }

  let repeatCount = 0;
  for (const block of recentBlocks.slice(recentWindowStart)) {
    if (block.kind !== "tool call" || block.toolName !== input.toolName) {
      continue;
    }

    const blockFingerprint = buildRepeatedActivityFingerprint({
      toolName: input.toolName,
      toolInput: block.input,
      workingDirectory: input.workingDirectory
    });
    if (blockFingerprint === fingerprint) {
      repeatCount += 1;
    }
  }

  return {
    repeatCount,
    shouldWarn: repeatCount >= REPEATED_ACTIVITY_WARN_THRESHOLD,
    shouldBlock: repeatCount >= REPEATED_ACTIVITY_BLOCK_THRESHOLD
  };
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
