import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  cloneForkSessionSnapshot,
  copyTaskBriefForFork,
  createRewriteRewindSnapshot,
  getCheckpointTriggerUserBlock,
  isForkCheckpointForFinalResponse,
  resolveTaskBriefPathForFork
} from "@ai-app-template/agent";
import type {
  SessionForkCheckpoint,
  SessionForkTarget,
  SessionRewriteTarget,
  SessionSnapshot,
  TraceManager
} from "@ai-app-template/agent";
import type { SessionSettingsRecord } from "@ai-app-template/domain";

import type { ApiAppDependencies } from "./app-context.js";

export const createSessionForkBodySchema = z
  .object({
    checkpointId: z.string().optional(),
    assistantMessageId: z.string().optional()
  })
  .refine(
    (value) =>
      (typeof value.checkpointId === "string" &&
        value.checkpointId.trim().length > 0) ||
      (typeof value.assistantMessageId === "string" &&
        value.assistantMessageId.trim().length > 0),
    {
      message: "checkpointId or assistantMessageId is required."
    }
  );

export const recoverRewriteTargetBodySchema = z.object({
  checkpointId: z.string().min(1),
  userMessageId: z.string().min(1)
});

export function normalizeSessionSearchQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function matchesSessionSearch(
  session: SessionSnapshot,
  normalizedQuery: string
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  if (session.sessionId.toLocaleLowerCase().includes(normalizedQuery)) {
    return true;
  }

  return session.messages.some((block) => {
    if (block.kind !== "user" && block.kind !== "assistant") {
      return false;
    }

    return block.content.toLocaleLowerCase().includes(normalizedQuery);
  });
}

export function toSessionForkTarget(
  checkpoint: SessionForkCheckpoint
): SessionForkTarget {
  return {
    checkpointId: checkpoint.id,
    assistantMessageId: checkpoint.assistantMessageId,
    turnCount: checkpoint.turnCount,
    responseGroupId: checkpoint.responseGroupId ?? null,
    canFork: true
  };
}

export function listForkableCheckpoints(
  checkpoints: SessionForkCheckpoint[]
): SessionForkCheckpoint[] {
  return checkpoints.filter(isForkCheckpointForFinalResponse);
}

export function buildMessageHookContentSet(
  settings: Pick<SessionSettingsRecord, "userContextHooks">
): Set<string> {
  return new Set(
    (settings.userContextHooks ?? [])
      .filter(
        (hook) =>
          hook.enabled &&
          (hook.behavior ??
            (hook.event === "run_end" ? "message" : "context")) === "message" &&
          hook.content.trim().length > 0
      )
      .map((hook) => hook.content.trim())
  );
}

export function resolveLatestRewriteTarget(input: {
  session: SessionSnapshot;
  checkpoints: SessionForkCheckpoint[];
  messageHookContents: Set<string>;
}): SessionRewriteTarget | null {
  for (let index = input.checkpoints.length - 1; index >= 0; index -= 1) {
    const checkpoint = input.checkpoints[index];
    if (!checkpoint) {
      continue;
    }

    const triggerBlock = getCheckpointTriggerUserBlock({
      session: input.session,
      checkpoint
    });
    if (!triggerBlock) {
      continue;
    }

    if (triggerBlock.source === "hook_message") {
      continue;
    }

    if (
      typeof triggerBlock.source !== "string" &&
      input.messageHookContents.has(triggerBlock.content.trim())
    ) {
      return null;
    }

    return {
      checkpointId: checkpoint.id,
      userMessageId: triggerBlock.id,
      turnCount: checkpoint.turnCount
    };
  }

  return null;
}

export function countTraceContextTokensBeforeTurn(
  events: Awaited<ReturnType<TraceManager["readEvents"]>>,
  turnCount: number
): number {
  return events.reduce((total, record) => {
    if (
      record.event.kind !== "response" ||
      record.event.turnCount >= turnCount
    ) {
      return total;
    }

    return (
      total +
      Math.max(
        0,
        (record.event.usage.inputTokens ?? 0) +
          (record.event.usage.cacheReadInputTokens ?? 0) +
          (record.event.usage.cacheCreationInputTokens ?? 0)
      )
    );
  }, 0);
}

export function resolveForkTaskBriefPath(input: {
  sourceSession: SessionSnapshot;
  targetSessionId: string;
}): string | null {
  return resolveTaskBriefPathForFork({
    workingDirectory: input.sourceSession.workingDirectory,
    sourceSessionId: input.sourceSession.sessionId,
    sourceTaskBriefPath: input.sourceSession.context.taskBriefPath,
    targetSessionId: input.targetSessionId,
    planModeEnabled: input.sourceSession.context.planModeEnabled
  });
}

export async function createForkSessionFromCheckpoint(input: {
  dependencies: ApiAppDependencies;
  sourceSession: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}): Promise<SessionSnapshot> {
  const forkSessionId = randomUUID();
  const forkTaskBriefPath = resolveForkTaskBriefPath({
    sourceSession: input.sourceSession,
    targetSessionId: forkSessionId
  });
  const forkSnapshot = cloneForkSessionSnapshot({
    checkpoint: input.checkpoint,
    sessionId: forkSessionId,
    taskBriefPath: forkTaskBriefPath
  });

  await input.dependencies.sessionManager.recover(forkSnapshot);
  await copyTaskBriefForFork({
    sourceTaskBriefPath: input.sourceSession.context.taskBriefPath,
    targetTaskBriefPath: forkTaskBriefPath
  });

  return forkSnapshot;
}
