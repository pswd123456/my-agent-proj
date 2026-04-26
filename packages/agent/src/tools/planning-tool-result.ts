import { createHash } from "node:crypto";

import type { DomainJsonValue, ScheduleSessionContext } from "@ai-app-template/domain";

type SessionTodoState = ScheduleSessionContext["todoState"];

export interface TodoWriteAck {
  [key: string]: DomainJsonValue;
  ack: "todo_list_replaced" | "todo_items_updated";
  itemIds: string[];
  activeItemId: string | null;
  hash: string;
}

export interface TaskBriefWriteAck {
  [key: string]: DomainJsonValue;
  ack: "task_brief_replaced";
  path: string;
}

function createShortHash(value: DomainJsonValue): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 12);
}

export function createTodoWriteAck(input: {
  ack: "todo_list_replaced" | "todo_items_updated";
  todoState: SessionTodoState | null;
}): TodoWriteAck {
  const todoState = input.todoState;
  const itemIds = todoState?.items.map((item) => item.id) ?? [];

  return {
    ack: input.ack,
    itemIds,
    activeItemId: todoState?.activeItemId ?? null,
    hash: createShortHash(
      todoState
        ? {
            items: todoState.items.map((item) => ({
              id: item.id,
              content: item.content,
              status: item.status,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt
            })),
            activeItemId: todoState.activeItemId,
            lastUpdatedAt: todoState.lastUpdatedAt
          }
        : {
            items: [],
            activeItemId: null,
            lastUpdatedAt: null
          }
    )
  };
}

export function createTaskBriefWriteAck(input: {
  path: string;
}): TaskBriefWriteAck {
  return {
    ack: "task_brief_replaced",
    path: input.path
  };
}
