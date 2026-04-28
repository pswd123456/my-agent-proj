import { promises as fs } from "node:fs";
import path from "node:path";

import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  writeTextFileAtomic
} from "./workspace.js";
import { readFileVersion } from "./fresh-session-read.js";

export type UnifiedPatchAction = "modify" | "create" | "delete";

export interface UnifiedPatchLine {
  kind: "context" | "delete" | "add";
  text: string;
}

export interface UnifiedPatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: UnifiedPatchLine[];
}

export interface UnifiedFilePatch {
  action: UnifiedPatchAction;
  oldPath: string | null;
  newPath: string | null;
  targetPath: string;
  hunks: UnifiedPatchHunk[];
}

export interface ParsedUnifiedPatch {
  files: UnifiedFilePatch[];
}

export interface PatchApplicationSummary {
  path: string;
  action: UnifiedPatchAction;
  hunkCount: number;
  addedLineCount: number;
  removedLineCount: number;
  diff: string;
  fileState:
    | {
        exists: true;
        sizeBytes: number;
        modifiedAtMs: number;
      }
    | {
        exists: false;
      };
}

type PatchChangeSummary = Omit<PatchApplicationSummary, "fileState">;

type PatchParseResult =
  | { ok: true; value: ParsedUnifiedPatch }
  | { ok: false; error: string };

type SplitContentResult = {
  lines: string[];
  newline: "\r\n" | "\n";
  hasFinalNewline: boolean;
};

function normalizePatchBody(patchText: string): string[] {
  const normalized = patchText.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function parsePatchPath(
  line: string,
  prefix: "--- " | "+++ ",
  side: "old" | "new"
): string | null {
  if (!line.startsWith(prefix)) {
    throw new Error(`Expected ${prefix.trim()} file header.`);
  }

  const firstToken = line
    .slice(prefix.length)
    .trimStart()
    .split("\t")[0]
    ?.trim();

  if (!firstToken) {
    throw new Error(`Missing ${side} file path in patch header.`);
  }

  if (firstToken === "/dev/null") {
    return null;
  }

  if (side === "old" && firstToken.startsWith("a/")) {
    return firstToken.slice(2);
  }
  if (side === "new" && firstToken.startsWith("b/")) {
    return firstToken.slice(2);
  }

  return firstToken;
}

function parseHunkHeader(line: string): UnifiedPatchHunk {
  const match = line.match(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/
  );

  if (!match) {
    throw new Error(`Invalid hunk header: ${line}`);
  }

  return {
    oldStart: Number.parseInt(match[1] ?? "0", 10),
    oldCount: Number.parseInt(match[2] ?? "1", 10),
    newStart: Number.parseInt(match[3] ?? "0", 10),
    newCount: Number.parseInt(match[4] ?? "1", 10),
    lines: []
  };
}

function splitFileContent(content: string): SplitContentResult {
  if (content.length === 0) {
    return {
      lines: [],
      newline: "\n",
      hasFinalNewline: false
    };
  }

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");
  const hasFinalNewline = normalized.endsWith("\n");
  const lines = (hasFinalNewline ? normalized.slice(0, -1) : normalized).split(
    "\n"
  );

  return {
    lines: lines[0] === "" && normalized.length === 0 ? [] : lines,
    newline,
    hasFinalNewline
  };
}

function renderFileContent(input: {
  lines: string[];
  newline: "\r\n" | "\n";
  hasFinalNewline: boolean;
}): string {
  if (input.lines.length === 0) {
    return input.hasFinalNewline ? input.newline : "";
  }

  const joined = input.lines.join(input.newline);
  return input.hasFinalNewline ? `${joined}${input.newline}` : joined;
}

function applyFilePatchToLines(input: {
  filePatch: UnifiedFilePatch;
  originalLines: string[];
  originalHasFinalNewline: boolean;
}): {
  nextLines: string[];
  hasFinalNewline: boolean;
} {
  const nextLines: string[] = [];
  let cursor = 0;

  for (const hunk of input.filePatch.hunks) {
    const targetIndex = Math.max(0, hunk.oldStart - 1);
    if (targetIndex < cursor) {
      throw new Error(
        `Patch hunks overlap in ${input.filePatch.targetPath}.`
      );
    }

    nextLines.push(...input.originalLines.slice(cursor, targetIndex));
    cursor = targetIndex;

    let consumedOldLines = 0;
    let producedNewLines = 0;

    for (const line of hunk.lines) {
      if (line.kind === "context") {
        if (input.originalLines[cursor] !== line.text) {
          throw new Error(
            `Patch context mismatch in ${input.filePatch.targetPath} near line ${Math.max(
              1,
              hunk.oldStart
            )}.`
          );
        }
        nextLines.push(line.text);
        cursor += 1;
        consumedOldLines += 1;
        producedNewLines += 1;
        continue;
      }

      if (line.kind === "delete") {
        if (input.originalLines[cursor] !== line.text) {
          throw new Error(
            `Patch deletion mismatch in ${input.filePatch.targetPath} near line ${Math.max(
              1,
              hunk.oldStart
            )}.`
          );
        }
        cursor += 1;
        consumedOldLines += 1;
        continue;
      }

      nextLines.push(line.text);
      producedNewLines += 1;
    }

    if (consumedOldLines !== hunk.oldCount || producedNewLines !== hunk.newCount) {
      throw new Error(
        `Patch hunk counts did not match for ${input.filePatch.targetPath}.`
      );
    }
  }

  nextLines.push(...input.originalLines.slice(cursor));

  return {
    nextLines,
    hasFinalNewline:
      input.filePatch.action === "delete"
        ? false
        : input.filePatch.action === "create"
          ? nextLines.length > 0
          : input.originalHasFinalNewline
  };
}

function summarizeFilePatch(filePatch: UnifiedFilePatch): PatchChangeSummary {
  const addedLineCount = filePatch.hunks.reduce(
    (count, hunk) => count + hunk.lines.filter((line) => line.kind === "add").length,
    0
  );
  const removedLineCount = filePatch.hunks.reduce(
    (count, hunk) =>
      count + hunk.lines.filter((line) => line.kind === "delete").length,
    0
  );

  return {
    path: filePatch.targetPath,
    action: filePatch.action,
    hunkCount: filePatch.hunks.length,
    addedLineCount,
    removedLineCount,
    diff: serializeUnifiedFilePatch(filePatch)
  };
}

export function serializeUnifiedFilePatch(filePatch: UnifiedFilePatch): string {
  const oldPath = filePatch.oldPath === null ? "/dev/null" : `a/${filePatch.oldPath}`;
  const newPath = filePatch.newPath === null ? "/dev/null" : `b/${filePatch.newPath}`;
  const lines = [`--- ${oldPath}`, `+++ ${newPath}`];

  for (const hunk of filePatch.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    );
    for (const line of hunk.lines) {
      const prefix =
        line.kind === "context" ? " " : line.kind === "add" ? "+" : "-";
      lines.push(`${prefix}${line.text}`);
    }
  }

  return lines.join("\n");
}

export function invertUnifiedFilePatch(
  filePatch: UnifiedFilePatch
): UnifiedFilePatch {
  const action: UnifiedPatchAction =
    filePatch.action === "create"
      ? "delete"
      : filePatch.action === "delete"
        ? "create"
        : "modify";

  return {
    action,
    oldPath: filePatch.newPath,
    newPath: filePatch.oldPath,
    targetPath: filePatch.targetPath,
    hunks: filePatch.hunks.map((hunk) => ({
      oldStart: hunk.newStart,
      oldCount: hunk.newCount,
      newStart: hunk.oldStart,
      newCount: hunk.oldCount,
      lines: (() => {
        const nextLines: UnifiedPatchLine[] = [];
        let deletedBlock: UnifiedPatchLine[] = [];
        let addedBlock: UnifiedPatchLine[] = [];

        const flushChangedBlock = () => {
          if (addedBlock.length > 0) {
            nextLines.push(
              ...addedBlock.map((line) => ({
                kind: "delete" as const,
                text: line.text
              }))
            );
          }
          if (deletedBlock.length > 0) {
            nextLines.push(
              ...deletedBlock.map((line) => ({
                kind: "add" as const,
                text: line.text
              }))
            );
          }
          deletedBlock = [];
          addedBlock = [];
        };

        for (const line of hunk.lines) {
          if (line.kind === "context") {
            flushChangedBlock();
            nextLines.push(line);
            continue;
          }

          if (line.kind === "delete") {
            deletedBlock.push(line);
            continue;
          }

          addedBlock.push(line);
        }

        flushChangedBlock();
        return nextLines;
      })()
    }))
  };
}

export function invertUnifiedPatch(
  patch: ParsedUnifiedPatch
): ParsedUnifiedPatch {
  return {
    files: [...patch.files].reverse().map(invertUnifiedFilePatch)
  };
}

export function listPatchTargets(patchText: string): string[] {
  const parsed = parseUnifiedPatch(patchText);
  if (!parsed.ok) {
    return [];
  }

  return [...new Set(parsed.value.files.map((filePatch) => filePatch.targetPath))];
}

export function parseUnifiedPatch(patchText: string): PatchParseResult {
  const normalizedPatch = patchText.trim();
  if (!normalizedPatch) {
    return {
      ok: false,
      error: "patch must be a non-empty string."
    };
  }

  const lines = normalizePatchBody(patchText);
  const files: UnifiedFilePatch[] = [];
  let index = 0;

  try {
    while (index < lines.length) {
      const currentLine = lines[index] ?? "";
      if (!currentLine || currentLine.startsWith("diff --git ")) {
        index += 1;
        continue;
      }
      if (currentLine.startsWith("Binary files ") || currentLine === "GIT binary patch") {
        throw new Error("Binary patches are not supported.");
      }
      if (!currentLine.startsWith("--- ")) {
        index += 1;
        continue;
      }

      const oldPath = parsePatchPath(currentLine, "--- ", "old");
      index += 1;
      const newPathLine = lines[index];
      if (!newPathLine) {
        throw new Error("Patch ended before the new file header.");
      }
      const newPath = parsePatchPath(newPathLine, "+++ ", "new");
      index += 1;

      if (!oldPath && !newPath) {
        throw new Error("Patch file section must target at least one path.");
      }
      if (oldPath && newPath && oldPath !== newPath) {
        throw new Error("Renaming paths via apply_patch is not supported.");
      }

      const action: UnifiedPatchAction =
        oldPath === null ? "create" : newPath === null ? "delete" : "modify";
      const targetPath = newPath ?? oldPath ?? "";
      const hunks: UnifiedPatchHunk[] = [];

      while (index < lines.length) {
        const line = lines[index] ?? "";
        if (line.startsWith("diff --git ") || line.startsWith("--- ")) {
          break;
        }
        if (!line) {
          index += 1;
          continue;
        }
        if (line.startsWith("Binary files ") || line === "GIT binary patch") {
          throw new Error("Binary patches are not supported.");
        }
        if (!line.startsWith("@@ ")) {
          index += 1;
          continue;
        }

        const hunk = parseHunkHeader(line);
        index += 1;

        while (index < lines.length) {
          const hunkLine = lines[index] ?? "";
          if (
            hunkLine.startsWith("@@ ") ||
            hunkLine.startsWith("--- ") ||
            hunkLine.startsWith("diff --git ")
          ) {
            break;
          }
          if (hunkLine === "\\ No newline at end of file") {
            index += 1;
            continue;
          }

          const prefix = hunkLine[0];
          if (prefix !== " " && prefix !== "+" && prefix !== "-") {
            throw new Error(`Unsupported patch body line: ${hunkLine}`);
          }
          hunk.lines.push({
            kind:
              prefix === " "
                ? "context"
                : prefix === "+"
                  ? "add"
                  : "delete",
            text: hunkLine.slice(1)
          });
          index += 1;
        }

        hunks.push(hunk);
      }

      if (hunks.length === 0) {
        throw new Error(`Patch for ${targetPath} did not contain any hunks.`);
      }

      files.push({
        action,
        oldPath,
        newPath,
        targetPath,
        hunks
      });
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: "No patch file sections were found."
    };
  }

  return {
    ok: true,
    value: {
      files
    }
  };
}

export async function applyUnifiedPatch(input: {
  workingDirectory: string;
  patch: ParsedUnifiedPatch;
  allowWorkspaceEscape: boolean;
}): Promise<PatchApplicationSummary[]> {
  const summaries: PatchApplicationSummary[] = [];

  for (const filePatch of input.patch.files) {
    const absoluteTargetPath = normalizeWorkspacePath(
      input.workingDirectory,
      filePatch.targetPath,
      input.allowWorkspaceEscape
    );
    const parentPath = path.dirname(absoluteTargetPath);
    const existingKind = await getPathKind(absoluteTargetPath);

    if (filePatch.action === "create") {
      if (existingKind !== "missing") {
        throw new Error(`Patch target already exists: ${filePatch.targetPath}.`);
      }
      if ((await getPathKind(parentPath)) !== "directory") {
        throw new Error(
          `Parent directory does not exist for ${filePatch.targetPath}.`
        );
      }
    } else {
      if (existingKind !== "file") {
        throw new Error(`Patch target is not a file: ${filePatch.targetPath}.`);
      }
    }

    const originalContent =
      filePatch.action === "create"
        ? ""
        : await fs.readFile(absoluteTargetPath, "utf8");
    const splitContent = splitFileContent(originalContent);
    const applied = applyFilePatchToLines({
      filePatch,
      originalLines: splitContent.lines,
      originalHasFinalNewline: splitContent.hasFinalNewline
    });

    if (filePatch.action === "delete") {
      await fs.rm(absoluteTargetPath, { force: false });
    } else {
      const existingStat =
        filePatch.action === "modify"
          ? await fs.stat(absoluteTargetPath)
          : null;
      await writeTextFileAtomic(
        absoluteTargetPath,
        renderFileContent({
          lines: applied.nextLines,
          newline: splitContent.newline,
          hasFinalNewline: applied.hasFinalNewline
        }),
        existingStat ? { mode: existingStat.mode } : {}
      );
    }

    summaries.push({
      ...summarizeFilePatch(filePatch),
      path: toRelativeWorkspacePath(input.workingDirectory, absoluteTargetPath),
      fileState:
        filePatch.action === "delete"
          ? { exists: false }
          : {
              exists: true,
              ...readFileVersion(await fs.stat(absoluteTargetPath))
            }
    });
  }

  return summaries;
}
