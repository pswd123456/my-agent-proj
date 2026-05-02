import { randomUUID } from "node:crypto";

import type { AnthropicMessage } from "../model.js";
import { toAnthropicMessages } from "../prompt.js";
import type {
  AssistantConversationBlock,
  ConversationBlock,
  SessionForkCheckpoint,
  SessionSnapshot,
  UserConversationBlock
} from "../types.js";
import {
  cloneSnapshot,
  getUserInputMessageBounds
} from "./shared.js";

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

export function getCheckpointTriggerUserMessageIndex(input: {
  session: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}): number | null {
  const triggerIndex = input.checkpoint.baseMessageCount - 1;
  if (triggerIndex < 0 || triggerIndex >= input.session.messages.length) {
    return null;
  }

  return input.session.messages[triggerIndex]?.kind === "user"
    ? triggerIndex
    : null;
}

export function getCheckpointTriggerUserBlock(input: {
  session: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}): UserConversationBlock | null {
  const triggerIndex = getCheckpointTriggerUserMessageIndex(input);
  if (triggerIndex === null) {
    return null;
  }

  const block = input.session.messages[triggerIndex];
  return block?.kind === "user" ? block : null;
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

export function createRewriteRewindSnapshot(input: {
  session: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}): SessionSnapshot {
  const triggerIndex = getCheckpointTriggerUserMessageIndex(input);
  if (triggerIndex === null) {
    throw new Error("Checkpoint trigger user message not found.");
  }

  const retainedMessages = input.session.messages
    .slice(0, triggerIndex)
    .map((block) => structuredClone(block));
  const { firstUserMessage, lastUserMessage } =
    getUserInputMessageBounds(retainedMessages);

  return cloneSnapshot({
    ...input.session,
    forkReplayCheckpointId: null,
    messages: retainedMessages,
    inputTokensCount: 0,
    promptCacheKey: "",
    context: {
      ...input.session.context,
      status: "waiting_for_user_input",
      activeBackgroundTaskCount: 0,
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingBackgroundNotifications: [],
      pendingConflictSummary: null,
      firstUserMessage,
      lastUserMessage
    },
    sessionState: {
      ...input.session.sessionState,
      loopState: "waiting for input",
      turnCount: Math.max(0, input.checkpoint.turnCount - 1),
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false
    }
  });
}

function cloneForkMessageBlock(block: ConversationBlock): ConversationBlock {
  return {
    ...structuredClone(block),
    id: randomUUID()
  };
}
