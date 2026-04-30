import type {
  UserContextHookEvent,
  UserContextHookRecord
} from "@ai-app-template/domain";
import {
  getUserContextHookTypeKey,
  inferUserContextHookBehavior
} from "@ai-app-template/domain";

import type { SessionSnapshot } from "./types.js";

export interface ResolvedUserContextHookSection {
  event: UserContextHookEvent;
  heading: string;
  description: string;
  hooks: UserContextHookRecord[];
}

const USER_CONTEXT_HOOK_EVENT_ORDER: UserContextHookEvent[] = [
  "session_started",
  "run_started"
];

function getSectionHeading(event: UserContextHookEvent): string {
  switch (event) {
    case "session_started":
      return "User context hooks for session start:";
    case "run_started":
      return "User context hooks for run start:";
    case "run_end":
      return "Unsupported user context hooks for run end:";
  }
}

function getSectionDescription(event: UserContextHookEvent): string {
  switch (event) {
    case "session_started":
      return "This session has just started. Apply these hooks throughout the current run.";
    case "run_started":
      return "Apply these hooks as operating context for the current run.";
    case "run_end":
      return "Run end hooks are supported only as message hooks.";
  }
}

function isFirstRunOfSession(
  session: Pick<SessionSnapshot, "sessionState">
): boolean {
  return Math.max(0, session.sessionState.turnCount) === 0;
}

function keepFirstHookPerType(
  hooks: UserContextHookRecord[]
): UserContextHookRecord[] {
  const seenTypeKeys = new Set<string>();
  const result: UserContextHookRecord[] = [];

  for (const hook of hooks) {
    const typeKey = getUserContextHookTypeKey(hook);
    if (seenTypeKeys.has(typeKey)) {
      continue;
    }

    seenTypeKeys.add(typeKey);
    result.push(hook);
  }

  return result;
}

export function resolveUserContextHookSections(input: {
  hooks: UserContextHookRecord[];
  session: Pick<SessionSnapshot, "sessionState">;
}): ResolvedUserContextHookSection[] {
  const isFirstRun = isFirstRunOfSession(input.session);

  return USER_CONTEXT_HOOK_EVENT_ORDER.flatMap((event) => {
    const hooks = keepFirstHookPerType(
      input.hooks.filter(
        (hook) =>
          hook.enabled &&
          inferUserContextHookBehavior(hook) === "context" &&
          hook.event === event &&
          (event !== "session_started" || isFirstRun)
      )
    );
    if (hooks.length === 0) {
      return [];
    }

    return [
      {
        event,
        heading: getSectionHeading(event),
        description: getSectionDescription(event),
        hooks
      }
    ];
  });
}

export function resolveUserContextMessageHooks(input: {
  hooks: UserContextHookRecord[];
  session: Pick<SessionSnapshot, "sessionState">;
  event: UserContextHookEvent;
}): UserContextHookRecord[] {
  const isFirstRun = isFirstRunOfSession(input.session);

  return keepFirstHookPerType(
    input.hooks.filter(
      (hook) =>
        hook.enabled &&
        inferUserContextHookBehavior(hook) === "message" &&
        hook.event === input.event &&
        (hook.event !== "session_started" || isFirstRun)
    )
  );
}
