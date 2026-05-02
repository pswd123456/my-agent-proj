import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { AnthropicMessage } from "../model.js";
import { toAnthropicMessages } from "../prompt.js";
import type {
  AssistantConversationBlock,
  ConversationBlock,
  SessionForkCheckpoint,
  SessionSnapshot
} from "../types.js";
import { cloneSnapshot } from "./shared.js";

export function findLastAssistantBlock(
  messages: SessionSnapshot["messages"]
): AssistantConversationBlock | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const block = messages[index];
    if (block?.kind === "assistant") {
      return block;
    }
  }

  return null;
}

export function buildForkReplayRequestMessages(input: {
  session: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}): AnthropicMessage[] {
  const replayBlocks = input.session.messages.slice(
    input.checkpoint.baseMessageCount
  );
  return [
    ...input.checkpoint.promptSeed.requestMessages,
    ...toAnthropicMessages(replayBlocks)
  ];
}

export function cloneForkSessionSnapshot(input: {
  checkpoint: SessionForkCheckpoint;
  sessionId: string;
  taskBriefPath: string | null;
}): SessionSnapshot {
  const snapshot = cloneSnapshot(input.checkpoint.snapshot);
  return cloneSnapshot({
    ...snapshot,
    sessionId: input.sessionId,
    messages: snapshot.messages.map(cloneForkMessageBlock),
    parentSessionId: input.checkpoint.sessionId,
    parentRelationKind: "fork",
    forkReplayCheckpointId: input.checkpoint.id,
    context: {
      ...snapshot.context,
      taskBriefPath: input.taskBriefPath,
      activeBackgroundTaskCount: 0,
      pendingBackgroundNotifications: [],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null
    },
    sessionState: {
      ...snapshot.sessionState,
      interruptRequested: false,
      pendingToolCallIds: []
    }
  });
}

function cloneForkMessageBlock(block: ConversationBlock): ConversationBlock {
  return {
    ...structuredClone(block),
    id: randomUUID()
  };
}

export async function copyTaskBriefForFork(input: {
  sourceTaskBriefPath: string | null | undefined;
  targetTaskBriefPath: string | null | undefined;
}): Promise<void> {
  if (
    typeof input.sourceTaskBriefPath !== "string" ||
    input.sourceTaskBriefPath.length === 0 ||
    typeof input.targetTaskBriefPath !== "string" ||
    input.targetTaskBriefPath.length === 0
  ) {
    return;
  }

  try {
    await fs.mkdir(path.dirname(input.targetTaskBriefPath), {
      recursive: true
    });
    await fs.copyFile(input.sourceTaskBriefPath, input.targetTaskBriefPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
