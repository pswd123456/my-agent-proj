import { promises as fs } from "node:fs";

import type { ToolExecutionContext } from "./runtime-tool.js";
import { parseStoredReadFileMetadata } from "./read-file-metadata.js";
import { createToolResult, failureResult } from "./tool-result.js";
import { toRelativeWorkspacePath } from "./workspace.js";

export type FreshSessionReadFailureCode =
  | "FILE_WRITE_REQUIRES_READ"
  | "FILE_CHANGED_SINCE_READ";

export interface FileVersion {
  sizeBytes: number;
  modifiedAtMs: number;
}

export function readFileVersion(
  stat: Awaited<ReturnType<typeof fs.stat>>
): FileVersion {
  return {
    sizeBytes: typeof stat.size === "bigint" ? Number(stat.size) : stat.size,
    modifiedAtMs:
      typeof stat.mtimeMs === "bigint" ? Number(stat.mtimeMs) : stat.mtimeMs
  };
}

export function readFileMode(
  stat: Awaited<ReturnType<typeof fs.stat>>
): number {
  return typeof stat.mode === "bigint" ? Number(stat.mode) : stat.mode;
}

export function fileVersionsMatch(
  left: FileVersion,
  right: FileVersion
): boolean {
  return (
    left.sizeBytes === right.sizeBytes &&
    left.modifiedAtMs === right.modifiedAtMs
  );
}

type SessionFileState =
  | {
      exists: true;
      version: FileVersion;
    }
  | {
      exists: false;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSessionFileState(value: unknown): SessionFileState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.exists === false) {
    return { exists: false };
  }

  if (
    (value.exists === true || value.exists === undefined) &&
    typeof value.sizeBytes === "number" &&
    typeof value.modifiedAtMs === "number"
  ) {
    return {
      exists: true,
      version: {
        sizeBytes: value.sizeBytes,
        modifiedAtMs: value.modifiedAtMs
      }
    };
  }

  return null;
}

function findLatestSessionFileStateForPath(input: {
  sessionMessages: ToolExecutionContext["sessionMessages"];
  workingDirectory: string;
  absolutePath: string;
}): SessionFileState | null {
  const expectedPath = toRelativeWorkspacePath(
    input.workingDirectory,
    input.absolutePath
  );

  for (let index = input.sessionMessages.length - 1; index >= 0; index -= 1) {
    const block = input.sessionMessages[index];
    if (!block || block.kind !== "tool result" || block.isError) {
      continue;
    }

    if (block.toolName === "read_file") {
      const metadata = parseStoredReadFileMetadata(block.output);
      if (!metadata || metadata.path !== expectedPath) {
        continue;
      }

      return {
        exists: true,
        version: {
          sizeBytes: metadata.sizeBytes,
          modifiedAtMs: metadata.modifiedAtMs
        }
      };
    }

    if (
      block.toolName !== "write_file" &&
      block.toolName !== "apply_patch" &&
      block.toolName !== "delete_file"
    ) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(block.output);
    } catch {
      continue;
    }

    if (!isRecord(parsed) || parsed.ok !== true || !isRecord(parsed.data)) {
      continue;
    }

    if (typeof parsed.data.path === "string") {
      if (parsed.data.path !== expectedPath) {
        continue;
      }

      const state = parseSessionFileState(parsed.data.fileState);
      if (state) {
        return state;
      }
    }

    if (!Array.isArray(parsed.data.files)) {
      continue;
    }

    for (const file of parsed.data.files) {
      if (!isRecord(file) || file.path !== expectedPath) {
        continue;
      }

      const state = parseSessionFileState(file.fileState);
      if (state) {
        return state;
      }
    }
  }

  return null;
}

export async function requireFreshSessionRead(input: {
  workingDirectory: string;
  absolutePath: string;
  sessionMessages: ToolExecutionContext["sessionMessages"];
}): Promise<
  | {
      ok: true;
      stat: Awaited<ReturnType<typeof fs.stat>>;
      version: FileVersion;
    }
  | { ok: false; code: FreshSessionReadFailureCode }
> {
  const currentStat = await fs.stat(input.absolutePath);
  const currentVersion = readFileVersion(currentStat);
  const previousState = findLatestSessionFileStateForPath({
    sessionMessages: input.sessionMessages,
    workingDirectory: input.workingDirectory,
    absolutePath: input.absolutePath
  });

  if (!previousState) {
    return { ok: false, code: "FILE_WRITE_REQUIRES_READ" };
  }

  if (
    !previousState.exists ||
    !fileVersionsMatch(previousState.version, currentVersion)
  ) {
    return { ok: false, code: "FILE_CHANGED_SINCE_READ" };
  }

  return { ok: true, stat: currentStat, version: currentVersion };
}

export function freshSessionReadFailureResult(input: {
  toolName: string;
  code: FreshSessionReadFailureCode;
  path: string;
}) {
  if (input.code === "FILE_WRITE_REQUIRES_READ") {
    return failureResult(
      createToolResult({
        ok: false,
        code: "FILE_WRITE_REQUIRES_READ",
        message:
          "Existing files must have a current session file state before modifying them. Read it with read_file first.",
        data: { path: input.path }
      }),
      `[${input.toolName}] failed\n- read_file required before modifying ${input.path}`
    );
  }

  return failureResult(
    createToolResult({
      ok: false,
      code: "FILE_CHANGED_SINCE_READ",
      message:
        "The file changed after the last session file state. Read it again before modifying it.",
      data: { path: input.path }
    }),
    `[${input.toolName}] failed\n- file changed since last session file state; read_file required before modifying ${input.path}`
  );
}
