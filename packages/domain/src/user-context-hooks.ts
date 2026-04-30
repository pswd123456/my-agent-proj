const USER_CONTEXT_HOOK_EVENT_SET = new Set([
  "session_started",
  "run_started",
  "run_end"
] as const);

const USER_CONTEXT_HOOK_BEHAVIOR_SET = new Set(["context", "message"] as const);

export const USER_CONTEXT_HOOK_EVENT_OPTIONS = [
  "session_started",
  "run_started",
  "run_end"
] as const;

export const USER_CONTEXT_HOOK_CONTEXT_EVENT_OPTIONS = [
  "session_started",
  "run_started"
] as const;

export const USER_CONTEXT_HOOK_MESSAGE_EVENT_OPTIONS =
  USER_CONTEXT_HOOK_EVENT_OPTIONS;

export const USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS = [
  "context",
  "message"
] as const;

export type UserContextHookEvent =
  (typeof USER_CONTEXT_HOOK_EVENT_OPTIONS)[number];

export type UserContextHookBehavior =
  (typeof USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS)[number];

export type UserContextHookTypeKey =
  `${UserContextHookBehavior}:${UserContextHookEvent}`;

export const USER_CONTEXT_HOOK_TYPES = [
  { behavior: "context", event: "session_started" },
  { behavior: "context", event: "run_started" },
  { behavior: "message", event: "session_started" },
  { behavior: "message", event: "run_started" },
  { behavior: "message", event: "run_end" }
] as const satisfies ReadonlyArray<{
  behavior: UserContextHookBehavior;
  event: UserContextHookEvent;
}>;

export interface UserContextHookRecord {
  id: string;
  event: UserContextHookEvent;
  behavior?: UserContextHookBehavior;
  title: string;
  content: string;
  enabled: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeUserContextHookEvent(
  value: unknown
): UserContextHookEvent | null {
  if (typeof value !== "string") {
    return null;
  }

  return USER_CONTEXT_HOOK_EVENT_SET.has(value as UserContextHookEvent)
    ? (value as UserContextHookEvent)
    : null;
}

export function normalizeUserContextHookBehavior(
  value: unknown
): UserContextHookBehavior | null {
  if (typeof value !== "string") {
    return null;
  }

  return USER_CONTEXT_HOOK_BEHAVIOR_SET.has(value as UserContextHookBehavior)
    ? (value as UserContextHookBehavior)
    : null;
}

export function inferUserContextHookBehavior(
  hook: Pick<UserContextHookRecord, "event" | "behavior">
): UserContextHookBehavior {
  const behavior = normalizeUserContextHookBehavior(hook.behavior);
  if (behavior) {
    return behavior;
  }

  return hook.event === "run_end" ? "message" : "context";
}

export function isUserContextHookEventSupportedForBehavior(
  event: UserContextHookEvent,
  behavior: UserContextHookBehavior
): boolean {
  if (behavior === "message") {
    return true;
  }

  return event !== "run_end";
}

export function getUserContextHookTypeKey(
  hook: Pick<UserContextHookRecord, "event" | "behavior">
): UserContextHookTypeKey {
  return `${inferUserContextHookBehavior(hook)}:${hook.event}`;
}

export function normalizeUserContextHooks(
  input: unknown
): UserContextHookRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenIds = new Set<string>();
  const enabledTypeKeys = new Set<UserContextHookTypeKey>();
  const normalized: UserContextHookRecord[] = [];

  for (const item of input) {
    if (!isPlainRecord(item)) {
      continue;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    const event = normalizeUserContextHookEvent(item.event);
    const explicitBehavior = normalizeUserContextHookBehavior(item.behavior);
    const behavior = event
      ? inferUserContextHookBehavior({
          event,
          ...(explicitBehavior ? { behavior: explicitBehavior } : {})
        })
      : null;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (
      !id ||
      !event ||
      !behavior ||
      !isUserContextHookEventSupportedForBehavior(event, behavior) ||
      !content ||
      seenIds.has(id)
    ) {
      continue;
    }

    const typeKey = getUserContextHookTypeKey({
      event,
      behavior
    });
    const requestedEnabled =
      typeof item.enabled === "boolean" ? item.enabled : true;
    const enabled = requestedEnabled && !enabledTypeKeys.has(typeKey);

    if (enabled) {
      enabledTypeKeys.add(typeKey);
    }

    seenIds.add(id);
    normalized.push({
      id,
      event,
      ...(explicitBehavior ? { behavior } : {}),
      title: typeof item.title === "string" ? item.title.trim() : "",
      content,
      enabled
    });
  }

  return normalized;
}
