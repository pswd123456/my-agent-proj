import { promises as fs } from "node:fs";

import type { ToolExecutionContext } from "./runtime-tool.js";
import { findLatestReadMetadataForPath } from "./read-file-metadata.js";
import { createToolResult, failureResult } from "./tool-result.js";

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
  const previousRead = findLatestReadMetadataForPath({
    sessionMessages: input.sessionMessages,
    workingDirectory: input.workingDirectory,
    absolutePath: input.absolutePath
  });

  if (!previousRead) {
    return { ok: false, code: "FILE_WRITE_REQUIRES_READ" };
  }

  if (!fileVersionsMatch(previousRead, currentVersion)) {
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
          "Existing files must be read with read_file in the current session before modifying them.",
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
        "The file changed after the last read_file result in this session. Read it again before modifying it.",
      data: { path: input.path }
    }),
    `[${input.toolName}] failed\n- file changed since last read; read_file required before modifying ${input.path}`
  );
}
