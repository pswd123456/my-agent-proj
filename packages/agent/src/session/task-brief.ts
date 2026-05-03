import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const TASK_BRIEF_TEMPLATE = [
  "# Task Brief",
  "",
  "## Goal",
  "",
  "## Acceptance Criteria",
  "",
  "## Constraints",
  "",
  "## Verified Facts",
  "",
  "## Decisions",
  "",
  "## Next Checkpoint",
  ""
].join("\n");

export interface TaskBriefReadResult {
  path: string | null;
  exists: boolean;
  content: string | null;
  truncated: boolean;
}

export type TaskBriefBindingState =
  | "unbound"
  | "bound_named"
  | "invalid";

export interface TaskBriefBindingInfo {
  state: TaskBriefBindingState;
  path: string | null;
  planFileName: string | null;
}

const TASK_BRIEF_PLAN_NAME_MAX_LENGTH = 64;

export function resolveTaskBriefDirectory(
  workingDirectory: string,
  sessionId: string
): string {
  return path.join(
    path.resolve(workingDirectory),
    ".agents",
    "plans",
    sessionId
  );
}

export function resolveTaskBriefPath(
  workingDirectory: string,
  sessionId: string,
  planName: string
): string {
  return path.join(
    resolveTaskBriefDirectory(workingDirectory, sessionId),
    planName
  );
}

export function normalizeTaskBriefPath(
  taskBriefPath: string | null | undefined
): string | null {
  if (typeof taskBriefPath !== "string" || taskBriefPath.trim().length === 0) {
    return null;
  }

  return path.resolve(taskBriefPath);
}

export function resolveTaskBriefPathForSession(input: {
  workingDirectory: string;
  sessionId: string;
  planModeEnabled?: boolean;
  taskBriefPath?: string | null;
}): string | null {
  const existing = normalizeTaskBriefPath(input.taskBriefPath);
  if (existing) {
    return existing;
  }

  if (!input.planModeEnabled) {
    return null;
  }

  return null;
}

export function isBoundTaskBriefPath(input: {
  workingDirectory: string;
  sessionId: string;
  taskBriefPath: string | null | undefined;
}): boolean {
  const normalized = normalizeTaskBriefPath(input.taskBriefPath);
  if (!normalized) {
    return false;
  }

  const expectedDirectory = resolveTaskBriefDirectory(
    input.workingDirectory,
    input.sessionId
  );
  if (path.dirname(normalized) !== expectedDirectory) {
    return false;
  }

  return isTaskBriefPlanFilename(path.basename(normalized));
}

export function describeTaskBriefBinding(input: {
  workingDirectory: string;
  sessionId: string;
  taskBriefPath: string | null | undefined;
}): TaskBriefBindingInfo {
  const normalized = normalizeTaskBriefPath(input.taskBriefPath);
  if (!normalized) {
    return {
      state: "unbound",
      path: null,
      planFileName: null
    };
  }

  const expectedDirectory = resolveTaskBriefDirectory(
    input.workingDirectory,
    input.sessionId
  );
  const planFileName = path.basename(normalized);
  if (
    path.dirname(normalized) === expectedDirectory &&
    isTaskBriefPlanFilename(planFileName)
  ) {
    return {
      state: "bound_named",
      path: normalized,
      planFileName
    };
  }

  return {
    state: "invalid",
    path: normalized,
    planFileName: null
  };
}

export function readTaskBrief(
  taskBriefPath: string | null | undefined,
  maxCharacters: number
): TaskBriefReadResult {
  const normalizedPath = normalizeTaskBriefPath(taskBriefPath);
  if (!normalizedPath || !existsSync(normalizedPath)) {
    return {
      path: normalizedPath,
      exists: false,
      content: null,
      truncated: false
    };
  }

  const content = readFileSync(normalizedPath, "utf8");
  if (content.length <= maxCharacters) {
    return {
      path: normalizedPath,
      exists: true,
      content,
      truncated: false
    };
  }

  return {
    path: normalizedPath,
    exists: true,
    content: content.slice(0, maxCharacters),
    truncated: true
  };
}

export function resolveTaskBriefPathForFork(input: {
  workingDirectory: string;
  sourceSessionId: string;
  sourceTaskBriefPath: string | null | undefined;
  targetSessionId: string;
  planModeEnabled: boolean;
}): string | null {
  const normalizedSourcePath = normalizeTaskBriefPath(input.sourceTaskBriefPath);

  const binding = describeTaskBriefBinding({
    workingDirectory: input.workingDirectory,
    sessionId: input.sourceSessionId,
    taskBriefPath: normalizedSourcePath
  });

  if (binding.state === "bound_named" && binding.planFileName) {
    return resolveTaskBriefPath(
      input.workingDirectory,
      input.targetSessionId,
      binding.planFileName
    );
  }

  return resolveTaskBriefPathForSession({
    workingDirectory: input.workingDirectory,
    sessionId: input.targetSessionId,
    planModeEnabled: input.planModeEnabled,
    taskBriefPath: null
  });
}

function slugifyPlanName(source: string): string {
  return source
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/[`*#]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/[_-]{2,}/g, "_")
    .slice(0, TASK_BRIEF_PLAN_NAME_MAX_LENGTH)
    .replace(/^_+|_+$/g, "");
}

function isTaskBriefPlanFilename(fileName: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*\.md$/i.test(fileName);
}

export function normalizeTaskBriefPlanName(planName: string): string | null {
  const slug = slugifyPlanName(planName);
  if (slug.length > 0) {
    return `${slug}.md`;
  }

  return null;
}
