import path from "node:path";

import type { MemorySummaryResultEnvelope } from "@ai-app-template/domain";

import type {
  ConversationBlock,
  SessionSnapshot,
  ToolResultDetails
} from "../types.js";
import {
  buildMemoryBody,
  collectSessionKeywords,
  type MemoryMetadata,
  writeMemoryDocument
} from "./store.js";

const TEXT_LIMIT = 1_200;
const TOOL_SUMMARY_LIMIT = 8;

export interface MemorySummaryTaskInput {
  session: SessionSnapshot;
  runId: string;
  taskId: string;
  stageKey: string;
  memoryDirectory?: string | null;
  now?: string;
}

export async function runMemorySummaryTask(
  input: MemorySummaryTaskInput
): Promise<MemorySummaryResultEnvelope> {
  const candidate = buildMemoryCandidateFromSession(input);
  if (!candidate) {
    return {
      type: "memory_summary",
      sourceSessionId: input.session.sessionId,
      stageKey: input.stageKey,
      memoryPath: null,
      outcome: "skipped",
      summary: "No reusable memory candidate found."
    };
  }

  const memoryPath = await writeMemoryDocument({
    metadata: candidate.metadata,
    body: candidate.body,
    ...(typeof input.memoryDirectory !== "undefined"
      ? { memoryDirectory: input.memoryDirectory }
      : {})
  });

  return {
    type: "memory_summary",
    sourceSessionId: input.session.sessionId,
    stageKey: input.stageKey,
    memoryPath,
    outcome: "written",
    summary: `Memory written: ${path.basename(memoryPath)}`
  };
}

export function buildMemoryCandidateFromSession(input: {
  session: SessionSnapshot;
  runId: string;
  taskId: string;
  stageKey: string;
  now?: string;
}): { metadata: MemoryMetadata; body: string } | null {
  const messages = input.session.messages;
  const firstUserMessage = messages.find(
    (block): block is Extract<ConversationBlock, { kind: "user" }> =>
      block.kind === "user" && block.content.trim().length > 0
  );
  const finalAnswer = [...messages]
    .reverse()
    .find(
      (block): block is Extract<ConversationBlock, { kind: "assistant" }> =>
        block.kind === "assistant" && block.content.trim().length > 0
    );
  const fileChanges = collectFileChanges(messages);
  const toolSummaries = collectToolSummaries(messages);

  if (!firstUserMessage || (!finalAnswer && fileChanges.length === 0)) {
    return null;
  }
  if (
    fileChanges.length === 0 &&
    toolSummaries.length === 0 &&
    (finalAnswer?.content.trim().length ?? 0) < 80
  ) {
    return null;
  }

  const now = input.now ?? new Date().toISOString();
  const touchedPaths = [...new Set(fileChanges.map((change) => change.path))];
  const toolNames = [
    ...new Set(
      messages
        .filter(
          (block): block is Extract<ConversationBlock, { kind: "tool call" }> =>
            block.kind === "tool call"
        )
        .map((block) => block.toolName)
    )
  ];
  const metadata: MemoryMetadata = {
    name: summarizeName(firstUserMessage.content),
    description: summarizeDescription(
      finalAnswer?.content ?? firstUserMessage.content
    ),
    cwd: input.session.workingDirectory,
    keywords: collectSessionKeywords(messages, [...toolNames, ...touchedPaths]),
    created_at: now,
    updated_at: now,
    last_verified_at: now,
    confidence:
      fileChanges.length > 0 || toolSummaries.length > 0 ? 0.72 : 0.58,
    touched_paths: touchedPaths,
    evidence_refs: [
      `session:${input.session.sessionId}`,
      `run:${input.runId}`,
      `task:${input.taskId}`,
      `stage:${input.stageKey}`
    ],
    source_session_id: input.session.sessionId
  };

  const body = buildMemoryBody({
    background: truncate(firstUserMessage.content),
    reusableConclusion: buildReusableConclusion({
      finalAnswer: finalAnswer?.content ?? "",
      fileChanges,
      toolSummaries
    }),
    evidence: buildEvidence({
      session: input.session,
      runId: input.runId,
      taskId: input.taskId,
      toolSummaries,
      fileChanges
    }),
    steps: buildSteps(toolSummaries, fileChanges),
    outdatedNotes: "暂无"
  });

  return { metadata, body };
}

function collectFileChanges(messages: ConversationBlock[]): Array<{
  path: string;
  action: string;
  addedLineCount: number;
  removedLineCount: number;
}> {
  const changes: Array<{
    path: string;
    action: string;
    addedLineCount: number;
    removedLineCount: number;
  }> = [];
  for (const block of messages) {
    if (block.kind !== "tool result" || !block.details) {
      continue;
    }
    const details = block.details as ToolResultDetails;
    if (details.kind !== "workspace_file_changes") {
      continue;
    }
    for (const file of details.files) {
      changes.push({
        path: file.path,
        action: file.action,
        addedLineCount: file.addedLineCount,
        removedLineCount: file.removedLineCount
      });
    }
  }
  return changes;
}

function collectToolSummaries(messages: ConversationBlock[]): string[] {
  return messages
    .filter(
      (block): block is Extract<ConversationBlock, { kind: "tool result" }> =>
        block.kind === "tool result" && block.output.trim().length > 0
    )
    .slice(-TOOL_SUMMARY_LIMIT)
    .map((block) => {
      const status = block.isError ? "error" : "ok";
      return `${block.toolName} [${status}]: ${truncate(block.output, 360)}`;
    });
}

function buildReusableConclusion(input: {
  finalAnswer: string;
  fileChanges: ReturnType<typeof collectFileChanges>;
  toolSummaries: string[];
}): string {
  const lines: string[] = [];
  if (input.finalAnswer.trim().length > 0) {
    lines.push(truncate(input.finalAnswer));
  }
  if (input.fileChanges.length > 0) {
    lines.push(
      `Touched files: ${input.fileChanges
        .map((change) => `${change.action}:${change.path}`)
        .join(", ")}`
    );
  }
  if (input.toolSummaries.length > 0) {
    lines.push(
      "Relevant tool evidence is listed below; verify against live code before relying on stale facts."
    );
  }
  return lines.join("\n\n");
}

function buildEvidence(input: {
  session: SessionSnapshot;
  runId: string;
  taskId: string;
  toolSummaries: string[];
  fileChanges: ReturnType<typeof collectFileChanges>;
}): string {
  const lines = [
    `session: ${input.session.sessionId}`,
    `run: ${input.runId}`,
    `background_task: ${input.taskId}`,
    `cwd: ${input.session.workingDirectory}`
  ];
  if (input.fileChanges.length > 0) {
    lines.push(
      ...input.fileChanges.map(
        (change) =>
          `file: ${change.action} ${change.path} (+${change.addedLineCount}/-${change.removedLineCount})`
      )
    );
  }
  if (input.toolSummaries.length > 0) {
    lines.push(...input.toolSummaries);
  }
  return lines.join("\n");
}

function buildSteps(
  toolSummaries: string[],
  fileChanges: ReturnType<typeof collectFileChanges>
): string {
  const steps: string[] = [];
  if (toolSummaries.length > 0) {
    steps.push(
      "1. Re-check current repository files and diagnostics before applying this memory."
    );
  }
  if (fileChanges.length > 0) {
    steps.push(
      `2. Start from touched paths: ${fileChanges
        .map((change) => change.path)
        .join(", ")}`
    );
  }
  if (steps.length === 0) {
    steps.push("1. Read the cited session/run evidence before reuse.");
  }
  return steps.join("\n");
}

function summarizeName(value: string): string {
  return truncate(value.replace(/\s+/g, " ").trim(), 80);
}

function summarizeDescription(value: string): string {
  return truncate(value.replace(/\s+/g, " ").trim(), 180);
}

function truncate(value: string, limit = TEXT_LIMIT): string {
  const normalized = value.trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit)}...`;
}
