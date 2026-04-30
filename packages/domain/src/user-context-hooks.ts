const USER_CONTEXT_HOOK_EVENT_SET = new Set([
  "session_started",
  "run_started",
  "run_end"
] as const);

export const USER_CONTEXT_HOOK_EVENT_OPTIONS = [
  "session_started",
  "run_started",
  "run_end"
] as const;

export type UserContextHookEvent =
  (typeof USER_CONTEXT_HOOK_EVENT_OPTIONS)[number];

export interface UserContextHookRecord {
  id: string;
  event: UserContextHookEvent;
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

export function normalizeUserContextHooks(
  input: unknown
): UserContextHookRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalized: UserContextHookRecord[] = [];

  for (const item of input) {
    if (!isPlainRecord(item)) {
      continue;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    const event = normalizeUserContextHookEvent(item.event);
    const content =
      typeof item.content === "string" ? item.content.trim() : "";
    if (!id || !event || !content || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    normalized.push({
      id,
      event,
      title: typeof item.title === "string" ? item.title.trim() : "",
      content,
      enabled: typeof item.enabled === "boolean" ? item.enabled : true
    });
  }

  return normalized;
}
