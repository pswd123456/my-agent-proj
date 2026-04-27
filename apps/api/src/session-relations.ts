import type { BackgroundTaskRepository } from "@ai-app-template/db";
import type { SessionSnapshot } from "@ai-app-template/agent";

function buildParentSessionIdMap(tasks: Awaited<
  ReturnType<BackgroundTaskRepository["listTasks"]>
>): Map<string, string> {
  const parentSessionIdByChildSessionId = new Map<string, string>();

  for (const task of tasks) {
    if (task.kind !== "subagent") {
      continue;
    }

    if (!task.parentSessionId || task.parentSessionId === task.childSessionId) {
      continue;
    }

    parentSessionIdByChildSessionId.set(
      task.childSessionId,
      task.parentSessionId
    );
  }

  return parentSessionIdByChildSessionId;
}

export async function enrichSessionSnapshotsWithParentRelation(input: {
  sessions: SessionSnapshot[];
  backgroundTaskRepository?: BackgroundTaskRepository | null | undefined;
}): Promise<SessionSnapshot[]> {
  if (!input.backgroundTaskRepository) {
    return input.sessions;
  }

  const tasks = await input.backgroundTaskRepository.listTasks();
  const parentSessionIdByChildSessionId = buildParentSessionIdMap(tasks);

  return input.sessions.map((session) => ({
    ...session,
    parentSessionId:
      parentSessionIdByChildSessionId.get(session.sessionId) ?? null
  }));
}
