import type {
  UserContextHookEvent,
  UserContextHookRecord
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
  "run_started",
  "run_end"
];

function getSectionHeading(event: UserContextHookEvent): string {
  switch (event) {
    case "session_started":
      return "User context hooks for session start:";
    case "run_started":
      return "User context hooks for run start:";
    case "run_end":
      return "User context hooks for run end:";
  }
}

function getSectionDescription(event: UserContextHookEvent): string {
  switch (event) {
    case "session_started":
      return "This session has just started. Apply these hooks throughout the current run.";
    case "run_started":
      return "Apply these hooks as operating context for the current run.";
    case "run_end":
      return "Apply these hooks only when you are ready to conclude the current run with a final answer.";
  }
}

export function resolveUserContextHookSections(input: {
  hooks: UserContextHookRecord[];
  session: Pick<SessionSnapshot, "sessionState">;
}): ResolvedUserContextHookSection[] {
  const isFirstRunOfSession =
    Math.max(0, input.session.sessionState.turnCount) === 0;

  return USER_CONTEXT_HOOK_EVENT_ORDER.flatMap((event) => {
    const hooks = input.hooks.filter(
      (hook) =>
        hook.enabled &&
        hook.event === event &&
        (event !== "session_started" || isFirstRunOfSession)
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
