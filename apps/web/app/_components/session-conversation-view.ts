import type { RunStreamEvent } from "@ai-app-template/sdk";

import { getTimelineEventKey, type TimelineItem } from "./session-timeline";

export type ConversationViewMode = "compact" | "debug";

export type CompactToolStatus = "running" | "success" | "failed" | "rejected";

export interface CompactToolViewItem {
  type: "compact-tool";
  key: string;
  createdAt: string;
  toolCallId: string;
  toolName: string;
  status: CompactToolStatus;
  title: string;
  target: string;
  originalItems: ConversationViewItem[];
}

export interface CompactFileBatchViewItem {
  type: "compact-file-batch";
  key: string;
  createdAt: string;
  title: string;
  targets: string[];
  originalItems: ConversationViewItem[];
}

export interface CompactCollapsedFlowViewItem {
  type: "compact-collapsed-flow";
  key: string;
  createdAt: string;
  hiddenCount: number;
  originalItems: ConversationViewItem[];
}

export type ConversationViewItem =
  | {
      type: "timeline";
      key: string;
      createdAt: string;
      item: TimelineItem;
    }
  | CompactToolViewItem
  | CompactFileBatchViewItem
  | CompactCollapsedFlowViewItem;

type ToolEvent = Extract<
  RunStreamEvent,
  | { kind: "tool_call" }
  | { kind: "tool_result" }
  | { kind: "permission_request" }
  | { kind: "permission_approved" }
  | { kind: "permission_rejected" }
  | { kind: "permission_blocked" }
>;

interface ToolGroup {
  toolCallId: string;
  toolName: string;
  createdAt: string;
  input: Record<string, unknown> | null;
  status: CompactToolStatus;
  originalItems: ConversationViewItem[];
}

function isToolEvent(event: RunStreamEvent): event is ToolEvent {
  return (
    event.kind === "tool_call" ||
    event.kind === "tool_result" ||
    event.kind === "permission_request" ||
    event.kind === "permission_approved" ||
    event.kind === "permission_rejected" ||
    event.kind === "permission_blocked"
  );
}

function isTurnBoundaryEvent(event: RunStreamEvent): boolean {
  return event.kind === "turn_start" || event.kind === "turn_end";
}

function toTimelineViewItem(item: TimelineItem): ConversationViewItem {
  return {
    type: "timeline",
    key: item.key,
    createdAt: item.createdAt,
    item
  };
}

function getToolAction(toolName: string): "read" | "search" | "edit" | "call" {
  if (toolName === "read_file") {
    return "read";
  }

  if (toolName === "search_text") {
    return "search";
  }

  if (
    [
      "write_file",
      "edit_file",
      "create_directory",
      "copy_path",
      "move_path",
      "delete_path",
      "create_routine",
      "edit_routine",
      "delete_routine"
    ].includes(toolName)
  ) {
    return "edit";
  }

  return "call";
}

function getToolVerb(input: {
  toolName: string;
  status: CompactToolStatus;
}): string {
  const action = getToolAction(input.toolName);

  if (input.status === "failed") {
    return `${action === "read" ? "阅读" : action === "search" ? "搜索" : action === "edit" ? "编辑" : "调用"}失败`;
  }

  if (input.status === "rejected") {
    return `已拒绝${action === "read" ? "阅读" : action === "search" ? "搜索" : action === "edit" ? "编辑" : "调用"}`;
  }

  const done = input.status === "success";
  if (action === "read") {
    return done ? "已阅读" : "正在阅读";
  }
  if (action === "search") {
    return done ? "已搜索" : "正在搜索";
  }
  if (action === "edit") {
    return done ? "已编辑" : "正在编辑";
  }
  return done ? "已查看" : "正在调用";
}

function stringifyValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function getToolTarget(
  toolName: string,
  input: Record<string, unknown> | null
): string {
  if (!input) {
    return toolName;
  }

  if (toolName === "search_text") {
    const query = stringifyValue(input.query) ?? toolName;
    const path = stringifyValue(input.path);
    return path ? `${query} @ ${path}` : query;
  }

  const path = stringifyValue(input.path);
  if (path) {
    return path;
  }

  const sourcePath = stringifyValue(input.source_path);
  const targetPath = stringifyValue(input.target_path);
  if (sourcePath && targetPath) {
    return `${sourcePath} -> ${targetPath}`;
  }

  const routineId = stringifyValue(input.routine_id);
  if (routineId) {
    return routineId;
  }

  const name = stringifyValue(input.name);
  if (name) {
    return name;
  }

  return toolName;
}

function toCompactToolViewItem(group: ToolGroup): CompactToolViewItem {
  const target = getToolTarget(group.toolName, group.input);
  return {
    type: "compact-tool",
    key: `compact-tool-${group.toolCallId}`,
    createdAt: group.createdAt,
    toolCallId: group.toolCallId,
    toolName: group.toolName,
    status: group.status,
    target,
    title: `${getToolVerb({
      toolName: group.toolName,
      status: group.status
    })} ${target}`,
    originalItems: group.originalItems
  };
}

function updateToolGroup(group: ToolGroup, event: ToolEvent): ToolGroup {
  const next: ToolGroup = {
    ...group,
    createdAt:
      group.createdAt < event.createdAt ? group.createdAt : event.createdAt,
    toolName: "toolName" in event ? event.toolName : group.toolName,
    originalItems: [
      ...group.originalItems,
      {
        type: "timeline",
        key: `tool-original-${getTimelineEventKey(event)}`,
        createdAt: event.createdAt,
        item: {
          type: "event",
          key: `event-${getTimelineEventKey(event)}`,
          createdAt: event.createdAt,
          event
        }
      }
    ]
  };

  if (event.kind === "tool_call") {
    next.input = event.input;
    next.status = "running";
  } else if (event.kind === "tool_result") {
    next.status = event.isError ? "failed" : "success";
  } else if (
    event.kind === "permission_rejected" ||
    event.kind === "permission_blocked"
  ) {
    next.status = "rejected";
  }

  return next;
}

function createToolGroup(event: ToolEvent): ToolGroup {
  return updateToolGroup(
    {
      toolCallId: event.toolCallId,
      toolName: "toolName" in event ? event.toolName : "tool",
      createdAt: event.createdAt,
      input: null,
      status: "running",
      originalItems: []
    },
    event
  );
}

function compactToolEvents(
  timelineItems: TimelineItem[]
): ConversationViewItem[] {
  const items: ConversationViewItem[] = [];
  const toolGroups = new Map<string, ToolGroup>();
  const toolIndexById = new Map<string, number>();

  for (const item of timelineItems) {
    if (item.type !== "event") {
      items.push(toTimelineViewItem(item));
      continue;
    }

    if (isTurnBoundaryEvent(item.event)) {
      continue;
    }

    if (!isToolEvent(item.event)) {
      items.push(toTimelineViewItem(item));
      continue;
    }

    const current = toolGroups.get(item.event.toolCallId);
    const next = current
      ? updateToolGroup(current, item.event)
      : createToolGroup(item.event);
    toolGroups.set(item.event.toolCallId, next);

    const existingIndex = toolIndexById.get(item.event.toolCallId);
    if (existingIndex === undefined) {
      toolIndexById.set(item.event.toolCallId, items.length);
      items.push(toCompactToolViewItem(next));
    } else {
      items[existingIndex] = toCompactToolViewItem(next);
    }
  }

  return items;
}

function isAssistantTextItem(item: ConversationViewItem): boolean {
  return (
    item.type === "timeline" &&
    item.item.type === "event" &&
    item.item.event.kind === "assistant_text"
  );
}

function isReadSearchToolItem(
  item: ConversationViewItem
): item is CompactToolViewItem {
  return (
    item.type === "compact-tool" &&
    item.status === "success" &&
    (item.toolName === "read_file" || item.toolName === "search_text")
  );
}

function compactReadSearchRuns(
  items: ConversationViewItem[]
): ConversationViewItem[] {
  const next: ConversationViewItem[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index]!;
    if (!isReadSearchToolItem(item)) {
      next.push(item);
      index += 1;
      continue;
    }

    const run: CompactToolViewItem[] = [item];
    let cursor = index + 1;
    while (cursor < items.length) {
      const candidate = items[cursor]!;
      if (!isReadSearchToolItem(candidate)) {
        break;
      }

      run.push(candidate);
      cursor += 1;
    }

    if (run.length === 1) {
      next.push(item);
    } else {
      next.push({
        type: "compact-file-batch",
        key: `compact-file-batch-${run[0]!.key}-${run.at(-1)!.key}`,
        createdAt: run[0]!.createdAt,
        title: `已搜索和阅读 ${run.length} 个文件`,
        targets: run.map((entry) => entry.target),
        originalItems: run
      });
    }

    index = cursor;
  }

  return next;
}

function isUserInputItem(item: ConversationViewItem): boolean {
  return (
    item.type === "timeline" &&
    (item.item.type === "pending-user" ||
      (item.item.type === "message" && item.item.block.kind === "user"))
  );
}

function getAssistantEvent(item: ConversationViewItem) {
  if (
    item.type === "timeline" &&
    item.item.type === "event" &&
    item.item.event.kind === "assistant_text"
  ) {
    return item.item.event;
  }

  return null;
}

function isAssistantMessageItem(item: ConversationViewItem): boolean {
  return (
    item.type === "timeline" &&
    item.item.type === "message" &&
    item.item.block.kind === "assistant"
  );
}

function compactFinalFlow(
  items: ConversationViewItem[]
): ConversationViewItem[] {
  const finalAssistant = [...items]
    .reverse()
    .map((item) => {
      const event = getAssistantEvent(item);
      return {
        item,
        event
      };
    })
    .find(({ event }) => event && event.text.trim().length > 0);

  if (!finalAssistant?.event) {
    return items;
  }

  const finalAssistantIndex = items.findIndex(
    (item) => item.key === finalAssistant.item.key
  );
  if (finalAssistantIndex < 0) {
    return items;
  }

  const hasLaterExecution = items
    .slice(finalAssistantIndex + 1)
    .some((item) => {
      if (isUserInputItem(item)) {
        return false;
      }

      return !(
        item.type === "timeline" &&
        item.item.type === "event" &&
        item.item.event.kind === "run_complete"
      );
    });
  if (hasLaterExecution) {
    return items;
  }

  let flowStartIndex = -1;
  for (let index = finalAssistantIndex - 1; index >= 0; index -= 1) {
    if (isUserInputItem(items[index]!)) {
      flowStartIndex = index;
      break;
    }
  }
  const hiddenKeys = new Set<string>();
  const hiddenItems: ConversationViewItem[] = [];

  for (const [index, item] of items.entries()) {
    if (item.key === finalAssistant.item.key || isUserInputItem(item)) {
      continue;
    }

    if (index > flowStartIndex && index < finalAssistantIndex) {
      hiddenKeys.add(item.key);
      hiddenItems.push(item);
    }
  }

  if (hiddenItems.length === 0) {
    return items;
  }

  const next: ConversationViewItem[] = [];
  let inserted = false;
  for (const item of items) {
    if (hiddenKeys.has(item.key)) {
      continue;
    }

    if (item.key === finalAssistant.item.key && !inserted) {
      next.push({
        type: "compact-collapsed-flow",
        key: `compact-collapsed-flow-${finalAssistant.item.key}`,
        createdAt: hiddenItems[0]!.createdAt,
        hiddenCount: hiddenItems.length,
        originalItems: hiddenItems
      });
      inserted = true;
    }

    next.push(item);
  }

  return next;
}

export function buildConversationViewItems(input: {
  timelineItems: TimelineItem[];
  mode: ConversationViewMode;
}): ConversationViewItem[] {
  if (input.mode === "debug") {
    return input.timelineItems.map(toTimelineViewItem);
  }

  return compactFinalFlow(
    compactReadSearchRuns(compactToolEvents(input.timelineItems))
  );
}

function getUserInputItemKey(item: ConversationViewItem): string | null {
  return isUserInputItem(item) ? item.key : null;
}

export function getCompactCollapsedFlowAnchors(input: {
  items: ConversationViewItem[];
  collapsedFlowKey: string;
}): {
  scrollTargetKey: string | null;
  assistantItemKey: string | null;
} {
  const collapsedFlowIndex = input.items.findIndex(
    (item) =>
      item.type === "compact-collapsed-flow" &&
      item.key === input.collapsedFlowKey
  );
  if (collapsedFlowIndex < 0) {
    return {
      scrollTargetKey: null,
      assistantItemKey: null
    };
  }

  const nextItem = input.items[collapsedFlowIndex + 1];
  const assistantItemKey =
    nextItem &&
    (getAssistantEvent(nextItem) || isAssistantMessageItem(nextItem))
      ? nextItem.key
      : null;
  const scrollTargetKey =
    [...input.items.slice(0, collapsedFlowIndex)]
      .reverse()
      .map(getUserInputItemKey)
      .find((key): key is string => Boolean(key)) ?? assistantItemKey;

  return {
    scrollTargetKey,
    assistantItemKey
  };
}

export function getCompactCollapsedFlowScrollTargetKey(input: {
  items: ConversationViewItem[];
  collapsedFlowKey: string;
}): string | null {
  return getCompactCollapsedFlowAnchors(input).scrollTargetKey;
}
