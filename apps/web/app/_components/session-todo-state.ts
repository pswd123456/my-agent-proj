import {
  TODO_TOOL_NAMES,
  type RunStreamEvent,
  type SessionSnapshot
} from "@ai-app-template/sdk";

type SessionTodoState = SessionSnapshot["context"]["todoState"];
type ToolResultEvent = Extract<RunStreamEvent, { kind: "tool_result" }>;
type TodoItemStatus = NonNullable<SessionTodoState>["items"][number]["status"];

const TODO_TOOL_NAME_SET = new Set<string>(TODO_TOOL_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTodoItemStatus(value: unknown): value is TodoItemStatus {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "done" ||
    value === "cancelled"
  );
}

function coerceTodoState(value: unknown): SessionTodoState | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return undefined;
  }

  const items: NonNullable<SessionTodoState>["items"] = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.content !== "string" ||
      !isTodoItemStatus(item.status) ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string"
    ) {
      return undefined;
    }

    items.push({
      id: item.id,
      content: item.content,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    });
  }

  const activeItemId = value.activeItemId;
  const lastUpdatedAt = value.lastUpdatedAt;
  if (
    (typeof activeItemId !== "string" && activeItemId !== null) ||
    (typeof lastUpdatedAt !== "string" && lastUpdatedAt !== null)
  ) {
    return undefined;
  }

  return {
    items,
    activeItemId,
    lastUpdatedAt
  };
}

export function isTodoToolName(toolName: string): boolean {
  return TODO_TOOL_NAME_SET.has(toolName);
}

export function getTodoStateFromToolResultEvent(
  event: ToolResultEvent
): SessionTodoState | null | undefined {
  if (!isTodoToolName(event.toolName) || event.isError) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.output);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || parsed.ok !== true) {
    return undefined;
  }

  if (!("data" in parsed) || parsed.data === undefined) {
    return null;
  }

  return coerceTodoState(parsed.data);
}

export function applyTodoToolResultToSession(
  session: SessionSnapshot,
  event: ToolResultEvent
): SessionSnapshot {
  const todoState = getTodoStateFromToolResultEvent(event);
  if (todoState === undefined) {
    return session;
  }

  return {
    ...session,
    context: {
      ...session.context,
      todoState
    }
  };
}
