import { createHash } from "node:crypto";

import type {
  HookContextEntry,
  SessionBackgroundNotification,
  UserContextHookRecord
} from "@ai-app-template/domain";
import { normalizeUserContextHookMaxTurns } from "@ai-app-template/domain";

import type { SessionSnapshot } from "./types.js";

export function isSubagentUserContextHook(
  hook: UserContextHookRecord
): hook is UserContextHookRecord & {
  behavior: "subagent";
  waitMode: "blocking" | "unblocking";
} {
  return (
    hook.enabled &&
    hook.behavior === "subagent" &&
    (hook.waitMode === "blocking" || hook.waitMode === "unblocking")
  );
}

export function getUserContextHookConfigHash(
  hook: Pick<
    UserContextHookRecord,
    "event" | "behavior" | "waitMode" | "maxTurns" | "title" | "content"
  >
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        event: hook.event,
        behavior: hook.behavior ?? null,
        waitMode: hook.waitMode ?? "blocking",
        maxTurns: normalizeUserContextHookMaxTurns(hook.maxTurns),
        title: hook.title.trim(),
        content: hook.content.trim()
      })
    )
    .digest("hex");
}

function findEnabledMatchingSubagentHook(
  hooks: UserContextHookRecord[],
  input: Pick<HookContextEntry, "hookId" | "configHash">
): UserContextHookRecord | null {
  for (const hook of hooks) {
    if (!isSubagentUserContextHook(hook) || hook.id !== input.hookId) {
      continue;
    }

    if (getUserContextHookConfigHash(hook) === input.configHash) {
      return hook;
    }
  }

  return null;
}

export function resolveInjectedHookContextEntries(input: {
  session: Pick<SessionSnapshot, "context">;
  hooks: UserContextHookRecord[];
}): HookContextEntry[] {
  const matchedEntries = input.session.context.hookContextEntries.filter(
    (entry) =>
      Boolean(
        findEnabledMatchingSubagentHook(input.hooks, {
          hookId: entry.hookId,
          configHash: entry.configHash
        })
      )
  );

  const sessionStartedEntries = matchedEntries
    .filter((entry) => entry.hookEvent === "session_started")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const runStartedEntries = matchedEntries
    .filter((entry) => entry.hookEvent === "run_started")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return [...sessionStartedEntries, ...runStartedEntries];
}

export function materializeHookContextEntries(input: {
  session: Pick<SessionSnapshot, "context">;
  hooks: UserContextHookRecord[];
}): {
  nextEntries: HookContextEntry[];
  consumedNotificationIds: string[];
  materializedEntries: HookContextEntry[];
} {
  const nextEntries = [...input.session.context.hookContextEntries];
  const consumedNotificationIds: string[] = [];
  const materializedEntries: HookContextEntry[] = [];

  for (const notification of input.session.context
    .pendingBackgroundNotifications) {
    if (notification.taskKind !== "hook_subagent") {
      continue;
    }

    if (notification.result?.type !== "hook_subagent") {
      continue;
    }

    const result = notification.result;
    const matchedHook = findEnabledMatchingSubagentHook(input.hooks, {
      hookId: result.hookId,
      configHash: result.configHash
    });
    consumedNotificationIds.push(notification.id);
    if (!matchedHook) {
      continue;
    }

    const entry: HookContextEntry = {
      hookId: result.hookId,
      hookEvent: result.hookEvent,
      waitMode: result.waitMode,
      taskId: notification.taskId,
      title: result.title,
      configHash: result.configHash,
      content: result.content,
      createdAt: notification.createdAt
    };

    if (entry.hookEvent === "session_started") {
      const filtered = nextEntries.filter(
        (candidate) =>
          !(
            candidate.hookEvent === "session_started" &&
            candidate.hookId === entry.hookId
          )
      );
      filtered.push(entry);
      nextEntries.splice(0, nextEntries.length, ...filtered);
    } else if (
      !nextEntries.some((candidate) => candidate.taskId === entry.taskId)
    ) {
      nextEntries.push(entry);
    }

    materializedEntries.push(entry);
  }

  nextEntries.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
  return {
    nextEntries,
    consumedNotificationIds,
    materializedEntries
  };
}
