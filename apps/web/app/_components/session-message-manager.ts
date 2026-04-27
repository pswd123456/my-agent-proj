import type { RunStreamEvent, SessionSnapshot, TraceRecord } from "@ai-app-template/sdk";

import {
  buildConversationViewItems,
  getCompactCollapsedFlowAnchors,
  type ConversationViewItem
} from "./session-conversation-view";
import { buildTimelineItems, getTimelineEventKey, type TimelineItem } from "./session-timeline";
import {
  collectToolRows,
  collectTurnUsage,
  flattenTraceRecords,
  type ToolRow
} from "./session-workbench-state";
import type { TurnUsageSummary } from "./session-workbench-types";

export type PendingUserMessage = {
  createdAt: string;
  text: string;
};

export interface MessageManagerState {
  streamEvents: RunStreamEvent[];
  recentAssistantEventKeys: Set<string>;
  pendingUserMessage: PendingUserMessage | null;
  expandedItemKeys: Set<string>;
  autoCollapsingItemKeys: Set<string>;
  seenCollapsedFlowKeys: Set<string>;
}

export type MessageLedgerEntry =
  | {
      source: "persisted-message";
      item: TimelineItem;
    }
  | {
      source: "stream-event";
      item: TimelineItem;
    }
  | {
      source: "pending-user";
      item: TimelineItem;
    };

export interface ExecutionFlowEntry {
  toolCallId: string;
  itemKey: string;
  status: "running" | "success" | "failed" | "rejected";
  originalItems: ConversationViewItem[];
}

export interface ConversationProjection {
  timelineItems: TimelineItem[];
  ledgerEntries: MessageLedgerEntry[];
  conversationItems: ConversationViewItem[];
  visibleItems: ConversationViewItem[];
  streamEventKeys: Set<string>;
  recentAssistantEventKeys: Set<string>;
  timestampedAssistantEventKeys: Set<string>;
  timestampedAssistantMessageIds: Set<string>;
  hiddenAssistantItemKeys: Set<string>;
  collapsedFlowAnchorsByKey: Map<
    string,
    { scrollTargetKey: string | null; assistantItemKey: string | null }
  >;
  newlyCollapsedFlowKeys: string[];
}

export interface InspectorProjection {
  inspectorEvents: RunStreamEvent[];
  promptEvents: Array<Extract<RunStreamEvent, { kind: "prompt" }>>;
  latestPromptEvent: Extract<RunStreamEvent, { kind: "prompt" }> | undefined;
  thinkingEvents: Array<Extract<RunStreamEvent, { kind: "thinking" }>>;
  toolRows: ToolRow[];
  turnUsageByTurnCount: Map<number, TurnUsageSummary>;
}

export interface MessageManagerProjection {
  historyEvents: RunStreamEvent[];
  conversation: ConversationProjection;
  inspector: InspectorProjection;
}

export type MessageManagerAction =
  | { type: "begin-run"; message: PendingUserMessage }
  | { type: "append-stream-event"; event: RunStreamEvent }
  | { type: "finish-run" }
  | { type: "mark-animation-complete"; key: string }
  | { type: "toggle-expanded"; key: string }
  | { type: "register-collapsed-flows"; keys: string[] }
  | { type: "complete-auto-collapse"; key: string }
  | { type: "reset-view-state" }
  | { type: "reset-all" };

export function createMessageManagerState(): MessageManagerState {
  return {
    streamEvents: [],
    recentAssistantEventKeys: new Set(),
    pendingUserMessage: null,
    expandedItemKeys: new Set(),
    autoCollapsingItemKeys: new Set(),
    seenCollapsedFlowKeys: new Set()
  };
}

export function beginMessageManagerRun(
  state: MessageManagerState,
  message: PendingUserMessage
): MessageManagerState {
  return {
    ...state,
    streamEvents: [],
    recentAssistantEventKeys: new Set(),
    pendingUserMessage: message
  };
}

export function appendMessageManagerEvent(
  state: MessageManagerState,
  event: RunStreamEvent
): MessageManagerState {
  const nextState: MessageManagerState = {
    ...state,
    streamEvents: [...state.streamEvents, event]
  };

  if (event.kind !== "assistant_text" && event.kind !== "thinking") {
    return nextState;
  }

  const nextRecentAssistantEventKeys = new Set(
    nextState.recentAssistantEventKeys
  );
  nextRecentAssistantEventKeys.add(getTimelineEventKey(event));

  return {
    ...nextState,
    recentAssistantEventKeys: nextRecentAssistantEventKeys
  };
}

export function finishMessageManagerRun(
  state: MessageManagerState
): MessageManagerState {
  if (!state.pendingUserMessage) {
    return state;
  }

  return {
    ...state,
    pendingUserMessage: null
  };
}

export function markMessageManagerAnimationComplete(
  state: MessageManagerState,
  key: string
): MessageManagerState {
  if (!state.recentAssistantEventKeys.has(key)) {
    return state;
  }

  const nextRecentAssistantEventKeys = new Set(state.recentAssistantEventKeys);
  nextRecentAssistantEventKeys.delete(key);

  return {
    ...state,
    recentAssistantEventKeys: nextRecentAssistantEventKeys
  };
}

export function toggleMessageManagerExpanded(
  state: MessageManagerState,
  key: string
): MessageManagerState {
  const nextExpandedItemKeys = new Set(state.expandedItemKeys);
  if (nextExpandedItemKeys.has(key)) {
    nextExpandedItemKeys.delete(key);
  } else {
    nextExpandedItemKeys.add(key);
  }

  return {
    ...state,
    expandedItemKeys: nextExpandedItemKeys
  };
}

export function registerMessageManagerCollapsedFlows(
  state: MessageManagerState,
  keys: string[]
): MessageManagerState {
  if (keys.length === 0) {
    return state;
  }

  const nextAutoCollapsingItemKeys = new Set(state.autoCollapsingItemKeys);
  const nextSeenCollapsedFlowKeys = new Set(state.seenCollapsedFlowKeys);

  for (const key of keys) {
    nextAutoCollapsingItemKeys.add(key);
    nextSeenCollapsedFlowKeys.add(key);
  }

  return {
    ...state,
    autoCollapsingItemKeys: nextAutoCollapsingItemKeys,
    seenCollapsedFlowKeys: nextSeenCollapsedFlowKeys
  };
}

export function completeMessageManagerAutoCollapse(
  state: MessageManagerState,
  key: string
): MessageManagerState {
  if (!state.autoCollapsingItemKeys.has(key)) {
    return state;
  }

  const nextAutoCollapsingItemKeys = new Set(state.autoCollapsingItemKeys);
  nextAutoCollapsingItemKeys.delete(key);

  return {
    ...state,
    autoCollapsingItemKeys: nextAutoCollapsingItemKeys
  };
}

export function resetMessageManagerViewState(
  state: MessageManagerState
): MessageManagerState {
  return {
    ...state,
    expandedItemKeys: new Set(),
    autoCollapsingItemKeys: new Set(),
    seenCollapsedFlowKeys: new Set()
  };
}

export function resetMessageManagerState(): MessageManagerState {
  return createMessageManagerState();
}

function toMessageLedgerEntries(
  timelineItems: TimelineItem[],
  streamEventKeys: Set<string>
): MessageLedgerEntry[] {
  return timelineItems.map((item) => {
    if (item.type === "pending-user") {
      return {
        source: "pending-user",
        item
      };
    }

    if (item.type === "event" && streamEventKeys.has(getTimelineEventKey(item.event))) {
      return {
        source: "stream-event",
        item
      };
    }

    return {
      source: "persisted-message",
      item
    };
  });
}

function getConversationViewEvent(
  item: ConversationViewItem
): RunStreamEvent | null {
  if (item.type === "timeline" && item.item.type === "event") {
    return item.item.event;
  }

  return null;
}

function getConversationViewAssistantMessageId(
  item: ConversationViewItem
): string | null {
  if (
    item.type === "timeline" &&
    item.item.type === "message" &&
    item.item.block.kind === "assistant"
  ) {
    return item.item.block.id;
  }

  return null;
}

function getConversationViewTurnCount(
  item: ConversationViewItem
): number | null {
  const event = getConversationViewEvent(item);
  if (event && "turnCount" in event) {
    return event.turnCount;
  }

  if (
    item.type === "compact-tool" ||
    item.type === "compact-file-batch" ||
    item.type === "compact-collapsed-flow"
  ) {
    const firstEvent = item.originalItems
      .map(getConversationViewEvent)
      .find((nestedEvent): nestedEvent is RunStreamEvent =>
        Boolean(nestedEvent && "turnCount" in nestedEvent)
      );

    return firstEvent && "turnCount" in firstEvent
      ? firstEvent.turnCount
      : null;
  }

  return null;
}

function shouldInvalidateAssistantFinalCandidate(
  item: ConversationViewItem
): boolean {
  const event = getConversationViewEvent(item);
  if (!event) {
    return item.type !== "timeline";
  }

  return (
    event.kind !== "turn_end" &&
    event.kind !== "run_complete" &&
    event.kind !== "assistant_text"
  );
}

function getTimestampedAssistantKeys(items: ConversationViewItem[]): {
  eventKeys: Set<string>;
  messageIds: Set<string>;
} {
  const eventKeys = new Set<string>();
  const messageIds = new Set<string>();
  let currentTurnCount: number | null = null;
  let finalAssistantCandidate:
    | { kind: "event"; key: string }
    | { kind: "message"; id: string }
    | null = null;

  function flushCurrentTurn() {
    if (!finalAssistantCandidate) {
      return;
    }

    if (finalAssistantCandidate.kind === "event") {
      eventKeys.add(finalAssistantCandidate.key);
    } else {
      messageIds.add(finalAssistantCandidate.id);
    }
  }

  for (const item of items) {
    const itemTurnCount = getConversationViewTurnCount(item);
    if (itemTurnCount !== null && itemTurnCount !== currentTurnCount) {
      flushCurrentTurn();
      currentTurnCount = itemTurnCount;
      finalAssistantCandidate = null;
    }

    const event = getConversationViewEvent(item);
    if (event?.kind === "assistant_text") {
      finalAssistantCandidate = {
        kind: "event",
        key: getTimelineEventKey(event)
      };
      continue;
    }

    const assistantMessageId = getConversationViewAssistantMessageId(item);
    if (assistantMessageId) {
      finalAssistantCandidate = {
        kind: "message",
        id: assistantMessageId
      };
      continue;
    }

    if (shouldInvalidateAssistantFinalCandidate(item)) {
      finalAssistantCandidate = null;
    }
  }

  flushCurrentTurn();

  return {
    eventKeys,
    messageIds
  };
}

function buildCollapsedFlowAnchorsByKey(
  conversationItems: ConversationViewItem[]
): ConversationProjection["collapsedFlowAnchorsByKey"] {
  const next = new Map<
    string,
    { scrollTargetKey: string | null; assistantItemKey: string | null }
  >();

  for (const item of conversationItems) {
    if (item.type !== "compact-collapsed-flow") {
      continue;
    }

    next.set(
      item.key,
      getCompactCollapsedFlowAnchors({
        items: conversationItems,
        collapsedFlowKey: item.key
      })
    );
  }

  return next;
}

function getHiddenAssistantItemKeys(input: {
  autoCollapsingItemKeys: Set<string>;
  collapsedFlowAnchorsByKey: ConversationProjection["collapsedFlowAnchorsByKey"];
}): Set<string> {
  const next = new Set<string>();

  for (const key of input.autoCollapsingItemKeys) {
    const assistantItemKey =
      input.collapsedFlowAnchorsByKey.get(key)?.assistantItemKey;
    if (assistantItemKey) {
      next.add(assistantItemKey);
    }
  }

  return next;
}

function getNewlyCollapsedFlowKeys(input: {
  conversationItems: ConversationViewItem[];
  seenCollapsedFlowKeys: Set<string>;
}): string[] {
  return input.conversationItems
    .filter(
      (item): item is Extract<ConversationViewItem, { type: "compact-collapsed-flow" }> =>
        item.type === "compact-collapsed-flow"
    )
    .map((item) => item.key)
    .filter((key) => !input.seenCollapsedFlowKeys.has(key));
}

export function buildMessageManagerProjection(input: {
  session: SessionSnapshot | null;
  traceRecords: TraceRecord[];
  debugConversationView: boolean;
  state: MessageManagerState;
}): MessageManagerProjection {
  const historyEvents = flattenTraceRecords(input.traceRecords);
  const inspectorEvents = input.state.streamEvents.length
    ? input.state.streamEvents
    : historyEvents;
  const promptEvents = inspectorEvents.filter(
    (event): event is Extract<RunStreamEvent, { kind: "prompt" }> =>
      event.kind === "prompt"
  );
  const thinkingEvents = inspectorEvents.filter(
    (event): event is Extract<RunStreamEvent, { kind: "thinking" }> =>
      event.kind === "thinking"
  );
  const latestPromptEvent = [...promptEvents].reverse().at(0);
  const turnUsageByTurnCount = collectTurnUsage([
    ...historyEvents,
    ...input.state.streamEvents
  ]);
  const toolRows = collectToolRows(inspectorEvents);
  const streamEventKeys = new Set(
    input.state.streamEvents.map((event) => getTimelineEventKey(event))
  );
  const timelineItems = buildTimelineItems({
    messages: input.session?.messages ?? [],
    historyEvents,
    streamEvents: input.state.streamEvents,
    pendingUserMessage: input.state.pendingUserMessage
  });
  const conversationItems = buildConversationViewItems({
    timelineItems,
    mode: input.debugConversationView ? "debug" : "compact",
    streamEventKeys
  });
  const collapsedFlowAnchorsByKey =
    buildCollapsedFlowAnchorsByKey(conversationItems);
  const hiddenAssistantItemKeys = getHiddenAssistantItemKeys({
    autoCollapsingItemKeys: input.state.autoCollapsingItemKeys,
    collapsedFlowAnchorsByKey
  });
  const visibleItems = conversationItems.filter(
    (item) => !hiddenAssistantItemKeys.has(item.key)
  );
  const timestampedAssistantKeys = getTimestampedAssistantKeys(conversationItems);
  const newlyCollapsedFlowKeys = getNewlyCollapsedFlowKeys({
    conversationItems,
    seenCollapsedFlowKeys: input.state.seenCollapsedFlowKeys
  });

  return {
    historyEvents,
    conversation: {
      timelineItems,
      ledgerEntries: toMessageLedgerEntries(timelineItems, streamEventKeys),
      conversationItems,
      visibleItems,
      streamEventKeys,
      recentAssistantEventKeys: input.state.recentAssistantEventKeys,
      timestampedAssistantEventKeys: timestampedAssistantKeys.eventKeys,
      timestampedAssistantMessageIds: timestampedAssistantKeys.messageIds,
      hiddenAssistantItemKeys,
      collapsedFlowAnchorsByKey,
      newlyCollapsedFlowKeys
    },
    inspector: {
      inspectorEvents,
      promptEvents,
      latestPromptEvent,
      thinkingEvents,
      toolRows,
      turnUsageByTurnCount
    }
  };
}
