import { randomUUID } from "node:crypto";

import type {
  SessionTodoItem,
  SessionTodoState,
  TodoItemStatus
} from "@ai-app-template/domain";

export const TODO_ITEM_LIMIT = 8;
export const TODO_ITEM_CONTENT_LIMIT = 120;
const TODO_OPEN_ITEM_SUMMARY_LIMIT = 6;

export type TodoUpdateOperation =
  | {
      type: "set_status";
      id: string;
      status: TodoItemStatus;
    }
  | {
      type: "set_content";
      id: string;
      content: string;
    }
  | {
      type: "append";
      content: string;
    }
  | {
      type: "remove";
      id: string;
    }
  | {
      type: "set_active";
      id: string | null;
    };

export function createEmptyTodoState(): SessionTodoState {
  return {
    items: [],
    activeItemId: null,
    lastUpdatedAt: null
  };
}

function truncateForSummary(value: string): string {
  if (value.length <= TODO_ITEM_CONTENT_LIMIT) {
    return value;
  }

  return `${value.slice(0, TODO_ITEM_CONTENT_LIMIT - 1)}…`;
}

function normalizeTodoContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function assertTodoContent(content: string): string {
  const normalized = normalizeTodoContent(content);
  if (normalized.length === 0) {
    throw new Error("Todo item content is required.");
  }
  if (normalized.length > TODO_ITEM_CONTENT_LIMIT) {
    throw new Error(
      `Todo item content must be at most ${TODO_ITEM_CONTENT_LIMIT} characters.`
    );
  }
  return normalized;
}

function ensureTodoLimit(count: number): void {
  if (count < 0 || count > TODO_ITEM_LIMIT) {
    throw new Error(`Todo list can contain at most ${TODO_ITEM_LIMIT} items.`);
  }
}

function findItemIndex(items: SessionTodoItem[], id: string): number {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error(`Unknown todo item: ${id}`);
  }
  return index;
}

function clearInProgress(
  items: SessionTodoItem[],
  now: string,
  exceptId?: string
): void {
  for (const item of items) {
    if (item.status === "in_progress" && item.id !== exceptId) {
      item.status = "pending";
      item.updatedAt = now;
    }
  }
}

function finalizeTodoState(
  state: SessionTodoState | null,
  touched: boolean,
  now: string
): SessionTodoState | null {
  if (!state || state.items.length === 0) {
    return null;
  }

  ensureTodoLimit(state.items.length);

  const activeItem =
    state.activeItemId === null
      ? null
      : (state.items.find((item) => item.id === state.activeItemId) ?? null);

  clearInProgress(state.items, now, activeItem?.id);

  if (activeItem) {
    if (activeItem.status === "done" || activeItem.status === "cancelled") {
      state.activeItemId = null;
    } else {
      activeItem.status = "in_progress";
    }
  }

  if (state.activeItemId === null) {
    for (const item of state.items) {
      if (item.status === "in_progress") {
        item.status = "pending";
        item.updatedAt = now;
      }
    }
  }

  state.lastUpdatedAt = touched ? now : (state.lastUpdatedAt ?? now);
  return state;
}

export function normalizeTodoState(
  value: SessionTodoState | null | undefined
): SessionTodoState | null {
  if (!value) {
    return null;
  }

  if (!Array.isArray(value.items)) {
    return null;
  }

  const items: SessionTodoItem[] = value.items.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      typeof item.content !== "string" ||
      typeof item.status !== "string" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string"
    ) {
      return [];
    }

    const normalizedContent = normalizeTodoContent(item.content);
    if (normalizedContent.length === 0) {
      return [];
    }

    const status = item.status;
    if (
      status !== "pending" &&
      status !== "in_progress" &&
      status !== "done" &&
      status !== "cancelled"
    ) {
      return [];
    }

    return [
      {
        id: item.id,
        content: normalizedContent.slice(0, TODO_ITEM_CONTENT_LIMIT),
        status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }
    ];
  });

  const candidate: SessionTodoState = {
    items,
    activeItemId:
      typeof value.activeItemId === "string" && value.activeItemId.length > 0
        ? value.activeItemId
        : null,
    lastUpdatedAt:
      typeof value.lastUpdatedAt === "string" ? value.lastUpdatedAt : null
  };

  return finalizeTodoState(
    candidate,
    false,
    candidate.lastUpdatedAt ?? new Date().toISOString()
  );
}

export function replaceTodoList(input: {
  items: Array<{ content: string }>;
  activeIndex?: number;
  now?: string;
}): SessionTodoState {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Todo list must contain at least one item.");
  }

  ensureTodoLimit(input.items.length);

  if (
    typeof input.activeIndex === "number" &&
    (!Number.isInteger(input.activeIndex) ||
      input.activeIndex < 0 ||
      input.activeIndex >= input.items.length)
  ) {
    throw new Error("activeIndex must point to an existing todo item.");
  }

  const now = input.now ?? new Date().toISOString();
  const items = input.items.map((item, index) => {
    const content = assertTodoContent(item.content);
    return {
      id: randomUUID(),
      content,
      status:
        typeof input.activeIndex === "number" && index === input.activeIndex
          ? "in_progress"
          : ("pending" satisfies TodoItemStatus),
      createdAt: now,
      updatedAt: now
    } satisfies SessionTodoItem;
  });

  return {
    items,
    activeItemId:
      typeof input.activeIndex === "number"
        ? (items[input.activeIndex]?.id ?? null)
        : null,
    lastUpdatedAt: now
  };
}

export function updateTodoState(input: {
  current: SessionTodoState | null | undefined;
  operations: TodoUpdateOperation[];
  now?: string;
}): SessionTodoState | null {
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    throw new Error("Todo update requires at least one operation.");
  }

  const now = input.now ?? new Date().toISOString();
  const state = normalizeTodoState(input.current) ?? {
    items: [],
    activeItemId: null,
    lastUpdatedAt: null
  };

  for (const operation of input.operations) {
    switch (operation.type) {
      case "append": {
        ensureTodoLimit(state.items.length + 1);
        state.items.push({
          id: randomUUID(),
          content: assertTodoContent(operation.content),
          status: "pending",
          createdAt: now,
          updatedAt: now
        });
        break;
      }
      case "remove": {
        const index = findItemIndex(state.items, operation.id);
        state.items.splice(index, 1);
        if (state.activeItemId === operation.id) {
          state.activeItemId = null;
        }
        break;
      }
      case "set_content": {
        const index = findItemIndex(state.items, operation.id);
        const existingItem = state.items[index];
        if (!existingItem) {
          throw new Error(`Unknown todo item: ${operation.id}`);
        }
        state.items[index] = {
          ...existingItem,
          content: assertTodoContent(operation.content),
          updatedAt: now
        };
        break;
      }
      case "set_status": {
        const index = findItemIndex(state.items, operation.id);
        const item = state.items[index];
        if (!item) {
          throw new Error(`Unknown todo item: ${operation.id}`);
        }
        item.status = operation.status;
        item.updatedAt = now;
        if (operation.status === "in_progress") {
          clearInProgress(state.items, now, operation.id);
          state.activeItemId = operation.id;
        } else if (state.activeItemId === operation.id) {
          state.activeItemId = null;
        }
        break;
      }
      case "set_active": {
        if (operation.id === null) {
          state.activeItemId = null;
          break;
        }

        const index = findItemIndex(state.items, operation.id);
        clearInProgress(state.items, now, operation.id);
        const existingItem = state.items[index];
        if (!existingItem) {
          throw new Error(`Unknown todo item: ${operation.id}`);
        }
        state.items[index] = {
          ...existingItem,
          status: "in_progress",
          updatedAt: now
        };
        state.activeItemId = operation.id;
        break;
      }
      default: {
        const exhaustiveCheck: never = operation;
        throw new Error(`Unsupported todo operation: ${exhaustiveCheck}`);
      }
    }
  }

  const finalized = finalizeTodoState(state, true, now);
  if (!finalized) {
    return null;
  }

  for (const item of finalized.items) {
    if (item.updatedAt.length === 0) {
      item.updatedAt = now;
    }
  }

  return finalized;
}

export function formatTodoStateSummary(
  value: SessionTodoState | null | undefined
): string {
  const state = normalizeTodoState(value);
  if (!state) {
    return ["Session todo state:", "none"].join("\n");
  }

  const activeItem =
    state.activeItemId === null
      ? null
      : (state.items.find((item) => item.id === state.activeItemId) ?? null);
  const openItems = state.items
    .filter((item) => item.status !== "done" && item.status !== "cancelled")
    .slice(0, TODO_OPEN_ITEM_SUMMARY_LIMIT);

  const lines = [
    "Session todo state:",
    `Active item: ${activeItem ? truncateForSummary(activeItem.content) : "none"}`,
    "Open items:"
  ];

  if (openItems.length === 0) {
    lines.push("none");
    return lines.join("\n");
  }

  for (const [index, item] of openItems.entries()) {
    lines.push(
      `${index + 1}. ${truncateForSummary(item.content)} [${item.status}]`
    );
  }

  return lines.join("\n");
}
