import type { BackgroundTaskRecord } from "@ai-app-template/domain";

import type { BackgroundTaskManager } from "../background-tasks/contracts.js";
import type { SessionManager } from "../session/contracts.js";
import type { SessionSnapshot } from "../types.js";
import { resolveMemoryDirectory } from "./store.js";

const DEFAULT_IDLE_MS = 10 * 60_000;

export interface EnqueueIdleMemorySummariesInput {
  sessionManager: SessionManager;
  taskManager: BackgroundTaskManager;
  listTasks(): Promise<BackgroundTaskRecord[]>;
  isMemoryEnabled?(workingDirectory: string): Promise<boolean>;
  idleMs?: number;
  now?: number;
  memoryDirectory?: string | null;
}

export interface EnqueueIdleMemorySummariesResult {
  scannedSessionCount: number;
  enqueuedTaskIds: string[];
}

export async function enqueueIdleMemorySummaries(
  input: EnqueueIdleMemorySummariesInput
): Promise<EnqueueIdleMemorySummariesResult> {
  const now = input.now ?? Date.now();
  const idleMs = Math.max(1_000, Math.floor(input.idleMs ?? DEFAULT_IDLE_MS));
  const [sessions, tasks] = await Promise.all([
    input.sessionManager.listSessions(),
    input.listTasks()
  ]);
  const enqueuedTaskIds: string[] = [];

  for (const session of sessions) {
    const stageKey = buildMemorySummaryStageKey(session);
    if (
      !(await shouldSummarizeSession({
        session,
        sessionManager: input.sessionManager,
        tasks,
        stageKey,
        now,
        idleMs
      }))
    ) {
      continue;
    }
    const enabled =
      input.isMemoryEnabled &&
      (await input.isMemoryEnabled(session.workingDirectory));
    if (!enabled) {
      continue;
    }

    const task = await input.taskManager.enqueueTask({
      kind: "memory_summary",
      executor: "memory_summary",
      message: "",
      workingDirectory: session.workingDirectory,
      model: session.model,
      maxTurns: 1,
      enabledCapabilityPacks: session.context.enabledCapabilityPacks,
      sourceSessionId: session.sessionId,
      stageKey,
      memoryDirectory: resolveMemoryDirectory(input.memoryDirectory),
      metadata: {
        reason: "idle_memory_summary",
        sourceSessionId: session.sessionId,
        stageKey
      },
      taskState: {
        kind: "memory_summary",
        sourceSessionId: session.sessionId,
        stageKey,
        latestResult: null
      },
      maxAttempts: 1
    });
    enqueuedTaskIds.push(task.taskId);
  }

  return {
    scannedSessionCount: sessions.length,
    enqueuedTaskIds
  };
}

export function buildMemorySummaryStageKey(session: SessionSnapshot): string {
  return `${session.updatedAt}:${session.messages.length}`;
}

async function shouldSummarizeSession(input: {
  session: SessionSnapshot;
  sessionManager: SessionManager;
  tasks: BackgroundTaskRecord[];
  stageKey: string;
  now: number;
  idleMs: number;
}): Promise<boolean> {
  if (input.session.parentSessionId || input.session.parentRelationKind) {
    return false;
  }
  if (input.session.messages.length === 0) {
    return false;
  }
  if (input.session.context.activeBackgroundTaskCount > 0) {
    return false;
  }
  if (
    input.session.context.status === "waiting_for_permission" ||
    input.session.context.status === "waiting_for_conflict_confirmation" ||
    input.session.context.status === "waiting_for_user_question"
  ) {
    return false;
  }
  if (input.session.sessionState.loopState === "running") {
    return false;
  }
  if (await input.sessionManager.isExecutionActive(input.session.sessionId)) {
    return false;
  }

  const updatedAt = new Date(input.session.updatedAt).getTime();
  if (!Number.isFinite(updatedAt) || input.now - updatedAt < input.idleMs) {
    return false;
  }

  return !input.tasks.some((task) => {
    if (task.kind !== "memory_summary") {
      return false;
    }
    const payload = task.payload;
    return (
      payload.executor === "memory_summary" &&
      payload.sourceSessionId === input.session.sessionId &&
      payload.stageKey === input.stageKey
    );
  });
}
