import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  truncateText
} from "./workspace.js";

const execFile = promisify(execFileCallback);

export const DEFAULT_GIT_OUTPUT_CHARACTERS = 20_000;
const GIT_COMMAND_TIMEOUT_MS = 30_000;

export interface NormalizedGitPathInput {
  relativePaths: string[];
  absolutePaths: string[];
}

export class GitCommandError extends Error {
  readonly code:
    | "GIT_NOT_AVAILABLE"
    | "NOT_GIT_REPOSITORY"
    | "GIT_COMMAND_FAILED";
  readonly stderr: string;
  readonly stdout: string;

  constructor(input: {
    code: "GIT_NOT_AVAILABLE" | "NOT_GIT_REPOSITORY" | "GIT_COMMAND_FAILED";
    message: string;
    stderr?: string;
    stdout?: string;
  }) {
    super(input.message);
    this.name = "GitCommandError";
    this.code = input.code;
    this.stderr = input.stderr ?? "";
    this.stdout = input.stdout ?? "";
  }
}

export function normalizePathListInput(
  value: unknown
): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const paths = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return paths.length === value.length ? paths : null;
}

export function validatePathListInput(value: unknown): {
  ok: boolean;
  issues?: Array<{ field: string; issue: string }>;
} {
  const normalized = normalizePathListInput(value);
  if (normalized !== null) {
    return { ok: true };
  }

  return {
    ok: false,
    issues: [
      {
        field: "paths",
        issue: "paths must be an array of non-empty strings."
      }
    ]
  };
}

export function normalizeGitPaths(input: {
  workingDirectory: string;
  rawPaths: string[] | undefined;
  allowWorkspaceEscape: boolean;
}): NormalizedGitPathInput {
  const rawPaths = input.rawPaths?.length ? input.rawPaths : ["."];
  const absolutePaths = rawPaths.map((rawPath) =>
    normalizeWorkspacePath(
      input.workingDirectory,
      rawPath,
      input.allowWorkspaceEscape
    )
  );

  return {
    absolutePaths,
    relativePaths: absolutePaths.map((absolutePath) =>
      toRelativeWorkspacePath(input.workingDirectory, absolutePath) || "."
    )
  };
}

export async function runGitCommand(input: {
  workingDirectory: string;
  args: string[];
  abortSignal?: AbortSignal;
}): Promise<string> {
  try {
    const { stdout } = await execFile("git", input.args, {
      cwd: input.workingDirectory,
      encoding: "utf8",
      signal: input.abortSignal,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: 512 * 1024
    });

    return stdout;
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stderr?: string;
      stdout?: string;
      code?: string | number;
    };
    const stderr = commandError.stderr ?? "";
    const stdout = commandError.stdout ?? "";
    const combinedMessage = [stderr, commandError.message].filter(Boolean).join(
      "\n"
    );

    if (commandError.code === "ENOENT") {
      throw new GitCommandError({
        code: "GIT_NOT_AVAILABLE",
        message: "git is not available in the runtime environment.",
        stderr,
        stdout
      });
    }

    if (
      /not a git repository/i.test(combinedMessage) ||
      /outside repository/i.test(combinedMessage)
    ) {
      throw new GitCommandError({
        code: "NOT_GIT_REPOSITORY",
        message: "Current working directory is not a git repository.",
        stderr,
        stdout
      });
    }

    throw new GitCommandError({
      code: "GIT_COMMAND_FAILED",
      message: combinedMessage || "git command failed.",
      stderr,
      stdout
    });
  }
}

export function truncateGitOutput(
  output: string,
  maxCharacters = DEFAULT_GIT_OUTPUT_CHARACTERS
): {
  text: string;
  truncated: boolean;
} {
  if (output.length <= maxCharacters) {
    return {
      text: output,
      truncated: false
    };
  }

  return {
    text: truncateText(output, maxCharacters),
    truncated: true
  };
}
