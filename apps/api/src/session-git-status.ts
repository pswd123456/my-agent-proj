import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  GitCommandError,
  runGitCommand,
  type SessionWorkspaceGitStatus
} from "@ai-app-template/agent";

interface GitLineTotals {
  addedLineCount: number;
  removedLineCount: number;
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

function parseNumstatTotals(stdout: string): GitLineTotals {
  return stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(Boolean)
    .reduce(
      (totals, line) => {
        const [added, removed] = line.split("\t", 3);
        return {
          addedLineCount:
            totals.addedLineCount +
            (added && added !== "-" ? Number.parseInt(added, 10) || 0 : 0),
          removedLineCount:
            totals.removedLineCount +
            (removed && removed !== "-"
              ? Number.parseInt(removed, 10) || 0
              : 0)
        };
      },
      { addedLineCount: 0, removedLineCount: 0 }
    );
}

function sumGitLineTotals(...totals: GitLineTotals[]): GitLineTotals {
  return totals.reduce(
    (result, entry) => ({
      addedLineCount: result.addedLineCount + entry.addedLineCount,
      removedLineCount: result.removedLineCount + entry.removedLineCount
    }),
    { addedLineCount: 0, removedLineCount: 0 }
  );
}

function isMissingHeadError(error: unknown): boolean {
  if (!(error instanceof GitCommandError)) {
    return false;
  }

  if (error.code !== "GIT_COMMAND_FAILED") {
    return false;
  }

  return /ambiguous argument ['"]HEAD['"]|bad revision ['"]HEAD['"]|unknown revision or path not in the working tree/i.test(
    error.message
  );
}

async function getTrackedLineTotals(
  workingDirectory: string
): Promise<GitLineTotals> {
  try {
    const stdout = await runGitCommand({
      workingDirectory,
      args: ["diff", "--numstat", "HEAD", "--", "."]
    });
    return parseNumstatTotals(stdout);
  } catch (error) {
    if (!isMissingHeadError(error)) {
      throw error;
    }

    const [stagedStdout, unstagedStdout] = await Promise.all([
      runGitCommand({
        workingDirectory,
        args: ["diff", "--cached", "--numstat", "--", "."]
      }),
      runGitCommand({
        workingDirectory,
        args: ["diff", "--numstat", "--", "."]
      })
    ]);

    return sumGitLineTotals(
      parseNumstatTotals(stagedStdout),
      parseNumstatTotals(unstagedStdout)
    );
  }
}

function countBufferLines(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  let lineCount = 0;
  for (const byte of buffer) {
    if (byte === 0x0a) {
      lineCount += 1;
    }
  }

  return buffer[buffer.length - 1] === 0x0a ? lineCount : lineCount + 1;
}

async function getUntrackedLineTotals(
  workingDirectory: string
): Promise<GitLineTotals> {
  const stdout = await runGitCommand({
    workingDirectory,
    args: ["ls-files", "--others", "--exclude-standard", "-z"]
  });
  const relativePaths = stdout.split("\0").filter(Boolean);

  if (relativePaths.length === 0) {
    return { addedLineCount: 0, removedLineCount: 0 };
  }

  const lineCounts = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const fileBuffer = await readFile(path.join(workingDirectory, relativePath));
      return countBufferLines(fileBuffer);
    })
  );

  return {
    addedLineCount: lineCounts.reduce((total, value) => total + value, 0),
    removedLineCount: 0
  };
}

async function getGitLineTotals(
  workingDirectory: string
): Promise<GitLineTotals> {
  const [trackedTotals, untrackedTotals] = await Promise.all([
    getTrackedLineTotals(workingDirectory),
    getUntrackedLineTotals(workingDirectory)
  ]);

  return sumGitLineTotals(trackedTotals, untrackedTotals);
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
    const lineTotals =
      entries.length === 0
        ? { addedLineCount: 0, removedLineCount: 0 }
        : await getGitLineTotals(workingDirectory);

    return {
      workingDirectory,
      ok: true,
      code: "GIT_STATUS_OK",
      message: "Git status loaded successfully.",
      branch: branch || null,
      clean: entries.length === 0,
      ...summary,
      ...lineTotals
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
      untrackedPathCount: 0,
      addedLineCount: 0,
      removedLineCount: 0
    };
  }
}
