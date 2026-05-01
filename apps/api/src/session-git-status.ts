import { GitCommandError, runGitCommand } from "@ai-app-template/agent";

export interface SessionWorkspaceGitStatus {
  workingDirectory: string;
  ok: boolean;
  code:
    | "GIT_STATUS_OK"
    | "GIT_NOT_AVAILABLE"
    | "NOT_GIT_REPOSITORY"
    | "GIT_STATUS_FAILED";
  message: string;
  branch: string | null;
  clean: boolean | null;
  changedPathCount: number;
  stagedPathCount: number;
  unstagedPathCount: number;
  untrackedPathCount: number;
}

interface ParsedGitStatusEntry {
  indexStatus: string;
  workTreeStatus: string;
  untracked: boolean;
}

function parseStatusEntries(lines: string[]): ParsedGitStatusEntry[] {
  return lines.filter(Boolean).map((line) => {
    if (line.startsWith("?? ")) {
      return {
        indexStatus: "?",
        workTreeStatus: "?",
        untracked: true
      };
    }

    return {
      indexStatus: line[0] ?? " ",
      workTreeStatus: line[1] ?? " ",
      untracked: false
    };
  });
}

function summarizeEntries(entries: ParsedGitStatusEntry[]) {
  let stagedPathCount = 0;
  let unstagedPathCount = 0;
  let untrackedPathCount = 0;

  for (const entry of entries) {
    if (entry.untracked) {
      untrackedPathCount += 1;
      continue;
    }

    if (entry.indexStatus.trim().length > 0) {
      stagedPathCount += 1;
    }
    if (entry.workTreeStatus.trim().length > 0) {
      unstagedPathCount += 1;
    }
  }

  return {
    changedPathCount: entries.length,
    stagedPathCount,
    unstagedPathCount,
    untrackedPathCount
  };
}

function toFailureCode(error: unknown): SessionWorkspaceGitStatus["code"] {
  const gitError = error as GitCommandError;
  if (gitError.code === "GIT_NOT_AVAILABLE") {
    return "GIT_NOT_AVAILABLE";
  }
  if (gitError.code === "NOT_GIT_REPOSITORY") {
    return "NOT_GIT_REPOSITORY";
  }
  return "GIT_STATUS_FAILED";
}

export async function getSessionWorkspaceGitStatus(
  workingDirectory: string
): Promise<SessionWorkspaceGitStatus> {
  try {
    const stdout = await runGitCommand({
      workingDirectory,
      args: [
        "status",
        "--short",
        "--branch",
        "--untracked-files=all",
        "--porcelain=v1"
      ]
    });
    const lines = stdout.replace(/\r\n/g, "\n").trimEnd().split("\n");
    const branch = lines[0]?.startsWith("## ")
      ? (lines.shift()?.slice(3) ?? "")
      : "";
    const entries = parseStatusEntries(lines);
    const summary = summarizeEntries(entries);

    return {
      workingDirectory,
      ok: true,
      code: "GIT_STATUS_OK",
      message: "Git status loaded successfully.",
      branch: branch || null,
      clean: entries.length === 0,
      ...summary
    };
  } catch (error) {
    return {
      workingDirectory,
      ok: false,
      code: toFailureCode(error),
      message: error instanceof Error ? error.message : String(error),
      branch: null,
      clean: null,
      changedPathCount: 0,
      stagedPathCount: 0,
      unstagedPathCount: 0,
      untrackedPathCount: 0
    };
  }
}
