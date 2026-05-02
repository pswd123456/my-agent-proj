import type { BackgroundTaskRepository } from "@ai-app-template/db";
import type { SessionSnapshot } from "@ai-app-template/agent";

function buildParentSessionIdMap(
  tasks: Awaited<ReturnType<BackgroundTaskRepository["listTasks"]>>
): Map<
  string,
  {
    parentSessionId: string;
    taskKind: NonNullable<SessionSnapshot["parentSessionTaskKind"]>;
  }
> {
  const parentSessionIdByChildSessionId = new Map<
    string,
    {
      parentSessionId: string;
      taskKind: NonNullable<SessionSnapshot["parentSessionTaskKind"]>;
    }
  >();

  for (const task of tasks) {
    if (task.kind !== "subagent" && task.kind !== "hook_subagent") {
      continue;
    }

    if (
      !task.parentSessionId ||
      !task.childSessionId ||
      task.parentSessionId === task.childSessionId
    ) {
      continue;
    }

    parentSessionIdByChildSessionId.set(task.childSessionId, {
      parentSessionId: task.parentSessionId,
      taskKind: task.kind
    });
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
      session.parentSessionId ??
      parentSessionIdByChildSessionId.get(session.sessionId)?.parentSessionId ??
      null,
    parentRelationKind:
      session.parentRelationKind ??
      (parentSessionIdByChildSessionId.get(session.sessionId)?.taskKind ===
      "hook_subagent"
        ? "hook_subagent"
        : parentSessionIdByChildSessionId.has(session.sessionId)
          ? "subagent"
          : null),
    parentSessionTaskKind:
      session.parentSessionTaskKind ??
      parentSessionIdByChildSessionId.get(session.sessionId)?.taskKind ??
      null
  }));
}

export function collectSessionTreeSessionIds(input: {
  sessions: SessionSnapshot[];
  rootSessionId: string;
}): string[] {
  const sessionsById = new Map(
    input.sessions.map((session) => [session.sessionId, session] as const)
  );
  if (!sessionsById.has(input.rootSessionId)) {
    return [];
  }

  const childrenByParentId = new Map<string, SessionSnapshot[]>();
  for (const session of input.sessions) {
    const parentSessionId = session.parentSessionId?.trim() ?? null;
    if (
      !parentSessionId ||
      parentSessionId === session.sessionId ||
      !sessionsById.has(parentSessionId)
    ) {
      continue;
    }

    const children = childrenByParentId.get(parentSessionId) ?? [];
    children.push(session);
    childrenByParentId.set(parentSessionId, children);
  }

  const visited = new Set<string>();
  const collected: string[] = [];

  function append(sessionId: string): void {
    if (visited.has(sessionId)) {
      return;
    }

    visited.add(sessionId);
    collected.push(sessionId);

    const children = [...(childrenByParentId.get(sessionId) ?? [])].sort(
      (left, right) => right.updatedAt.localeCompare(left.updatedAt)
    );
    for (const child of children) {
      append(child.sessionId);
    }
  }

  append(input.rootSessionId);
  return collected;
}
