import type { ConversationBlock, JsonValue } from "../types.js";
import {
  normalizeReadFileActivityIdentity,
  toRelativeWorkspacePath
} from "./workspace.js";

export interface StoredReadFileMetadata {
  path: string;
  offset: number;
  limit: number | null;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  sizeBytes: number;
  modifiedAt: string;
  modifiedAtMs: number;
  deduplicated?: boolean;
}

function isStoredReadFileMetadata(
  value: unknown
): value is StoredReadFileMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.offset === "number" &&
    (candidate.limit === null || typeof candidate.limit === "number") &&
    typeof candidate.content === "string" &&
    typeof candidate.startLine === "number" &&
    typeof candidate.endLine === "number" &&
    typeof candidate.totalLines === "number" &&
    typeof candidate.truncated === "boolean" &&
    typeof candidate.sizeBytes === "number" &&
    typeof candidate.modifiedAt === "string" &&
    typeof candidate.modifiedAtMs === "number"
  );
}

export function parseStoredReadFileMetadata(
  output: string
): StoredReadFileMetadata | null {
  try {
    const parsed = JSON.parse(output) as {
      ok?: unknown;
      data?: unknown;
    };
    if (parsed.ok !== true || !isStoredReadFileMetadata(parsed.data)) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function findPreviousReadMetadata(input: {
  sessionMessages: ConversationBlock[];
  workingDirectory: string;
  currentInput: Record<string, JsonValue>;
}): StoredReadFileMetadata | null {
  const callBlocks = new Map<string, ConversationBlock>();
  for (const block of input.sessionMessages) {
    if (block.kind === "tool call" && block.toolName === "read_file") {
      callBlocks.set(block.toolCallId, block);
    }
  }

  const currentIdentity = normalizeReadFileActivityIdentity({
    toolInput: input.currentInput,
    workingDirectory: input.workingDirectory
  });

  for (let index = input.sessionMessages.length - 1; index >= 0; index -= 1) {
    const block = input.sessionMessages[index];
    if (
      !block ||
      block.kind !== "tool result" ||
      block.toolName !== "read_file" ||
      block.isError
    ) {
      continue;
    }

    const matchingCall = callBlocks.get(block.toolCallId);
    if (!matchingCall || matchingCall.kind !== "tool call") {
      continue;
    }

    const blockIdentity = normalizeReadFileActivityIdentity({
      toolInput: matchingCall.input,
      workingDirectory: input.workingDirectory
    });
    if (
      blockIdentity.path !== currentIdentity.path ||
      blockIdentity.offset !== currentIdentity.offset ||
      blockIdentity.limit !== currentIdentity.limit
    ) {
      continue;
    }

    const metadata = parseStoredReadFileMetadata(block.output);
    if (!metadata || metadata.deduplicated || metadata.truncated) {
      continue;
    }

    return metadata;
  }

  return null;
}

export function findLatestReadMetadataForPath(input: {
  sessionMessages: ConversationBlock[];
  workingDirectory: string;
  absolutePath: string;
}): StoredReadFileMetadata | null {
  const expectedPath = toRelativeWorkspacePath(
    input.workingDirectory,
    input.absolutePath
  );

  for (let index = input.sessionMessages.length - 1; index >= 0; index -= 1) {
    const block = input.sessionMessages[index];
    if (
      !block ||
      block.kind !== "tool result" ||
      block.toolName !== "read_file" ||
      block.isError
    ) {
      continue;
    }

    const metadata = parseStoredReadFileMetadata(block.output);
    if (!metadata || metadata.path !== expectedPath) {
      continue;
    }

    return metadata;
  }

  return null;
}
