import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

export type TimelineItem =
  | {
      type: "event";
      key: string;
      createdAt: string;
      event: RunStreamEvent;
    }
  | {
      type: "message";
      key: string;
      createdAt: string;
      block: SessionSnapshot["messages"][number];
    }
  | {
      type: "pending-user";
      key: string;
      createdAt: string;
      text: string;
    };

interface PendingUserMessage {
  text: string;
  createdAt: string;
}

function isVisibleTimelineEvent(event: RunStreamEvent): boolean {
  return event.kind !== "prompt" && event.kind !== "response";
}

function getEventSortOrder(event: RunStreamEvent): number {
  switch (event.kind) {
    case "turn_start":
      return 0;
    case "thinking":
      return 1;
    case "assistant_text":
      return 2;
    case "tool_call":
      return 3;
    case "tool_result":
      return 4;
    case "fallback":
      return 5;
    case "run_error":
      return 6;
    case "run_complete":
      return 7;
    case "turn_end":
      return 8;
    default:
      return 9;
  }
}

function compareByCreatedAt(
  left: { createdAt: string; key: string },
  right: { createdAt: string; key: string }
): number {
  if (left.createdAt === right.createdAt) {
    return left.key.localeCompare(right.key);
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function compareEvents(left: RunStreamEvent, right: RunStreamEvent): number {
  if (left.createdAt === right.createdAt) {
    return (
      getEventSortOrder(left) - getEventSortOrder(right) ||
      getTimelineEventKey(left).localeCompare(getTimelineEventKey(right))
    );
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function buildMessageTimeline(
  messages: SessionSnapshot["messages"],
  pendingUserMessage: PendingUserMessage | null | undefined
): TimelineItem[] {
  const items: TimelineItem[] = messages.map((block) => ({
    type: "message",
    key: `message-${block.id}`,
    createdAt: block.createdAt,
    block
  }));

  if (pendingUserMessage) {
    items.push({
      type: "pending-user",
      key: `pending-user-${pendingUserMessage.createdAt}`,
      createdAt: pendingUserMessage.createdAt,
      text: pendingUserMessage.text
    });
  }

  return items.sort(compareByCreatedAt);
}

function matchesConversationBlock(
  block: SessionSnapshot["messages"][number],
  event: RunStreamEvent
): boolean {
  if (block.kind === "assistant" && event.kind === "assistant_text") {
    return block.content === event.text;
  }

  if (block.kind === "tool call" && event.kind === "tool_call") {
    return block.toolCallId === event.toolCallId;
  }

  if (block.kind === "tool result" && event.kind === "tool_result") {
    return block.toolCallId === event.toolCallId;
  }

  return false;
}

export function getTimelineEventKey(event: RunStreamEvent): string {
  if (event.kind === "tool_call" || event.kind === "tool_result") {
    return `${event.kind}-${event.toolCallId}-${event.createdAt}`;
  }

  if (event.kind === "thinking") {
    return `${event.kind}-${event.signature}-${event.createdAt}`;
  }

  if (event.kind === "run_complete" || event.kind === "run_error") {
    return `${event.kind}-${event.createdAt}-${event.sessionId}`;
  }

  return `${event.kind}-${event.createdAt}`;
}

export function buildTimelineItems(input: {
  messages: SessionSnapshot["messages"];
  historyEvents: RunStreamEvent[];
  streamEvents: RunStreamEvent[];
  pendingUserMessage?: PendingUserMessage | null;
}): TimelineItem[] {
  const visibleEventMap = new Map<string, RunStreamEvent>();

  for (const event of [...input.historyEvents, ...input.streamEvents]) {
    if (!isVisibleTimelineEvent(event)) {
      continue;
    }

    visibleEventMap.set(getTimelineEventKey(event), event);
  }

  const visibleEvents = [...visibleEventMap.values()].sort(compareEvents);

  if (visibleEvents.length === 0) {
    return buildMessageTimeline(input.messages, input.pendingUserMessage);
  }

  const consumedMessageIds = new Set<string>();
  for (const event of visibleEvents) {
    const matchedBlock = input.messages.find(
      (block) =>
        !consumedMessageIds.has(block.id) &&
        matchesConversationBlock(block, event)
    );

    if (matchedBlock) {
      consumedMessageIds.add(matchedBlock.id);
    }
  }

  const userItems: TimelineItem[] = input.messages
    .filter(
      (
        block
      ): block is Extract<
        SessionSnapshot["messages"][number],
        { kind: "user" }
      > => block.kind === "user"
    )
    .map((block) => ({
      type: "message",
      key: `message-${block.id}`,
      createdAt: block.createdAt,
      block
    }));

  if (input.pendingUserMessage) {
    userItems.push({
      type: "pending-user",
      key: `pending-user-${input.pendingUserMessage.createdAt}`,
      createdAt: input.pendingUserMessage.createdAt,
      text: input.pendingUserMessage.text
    });
  }

  userItems.sort(compareByCreatedAt);

  const turnStartEvents = visibleEvents.filter(
    (event): event is Extract<RunStreamEvent, { kind: "turn_start" }> =>
      event.kind === "turn_start"
  );
  const usersByTurnStart = new Map<string, TimelineItem[]>();
  const orphanUsers: TimelineItem[] = [];
  let turnStartIndex = 0;

  for (const userItem of userItems) {
    while (
      turnStartIndex < turnStartEvents.length &&
      turnStartEvents[turnStartIndex]!.createdAt < userItem.createdAt
    ) {
      turnStartIndex += 1;
    }

    const nextTurnStart = turnStartEvents[turnStartIndex];
    if (!nextTurnStart) {
      orphanUsers.push(userItem);
      continue;
    }

    const key = getTimelineEventKey(nextTurnStart);
    const assignedUsers = usersByTurnStart.get(key) ?? [];
    assignedUsers.push(userItem);
    usersByTurnStart.set(key, assignedUsers);
    turnStartIndex += 1;
  }

  const standaloneItems: TimelineItem[] = [
    ...orphanUsers,
    ...input.messages
      .filter(
        (block) => block.kind !== "user" && !consumedMessageIds.has(block.id)
      )
      .map((block) => ({
        type: "message" as const,
        key: `message-${block.id}`,
        createdAt: block.createdAt,
        block
      }))
  ].sort(compareByCreatedAt);

  const items: TimelineItem[] = [];
  let standaloneIndex = 0;

  for (const event of visibleEvents) {
    while (
      standaloneIndex < standaloneItems.length &&
      standaloneItems[standaloneIndex]!.createdAt < event.createdAt
    ) {
      items.push(standaloneItems[standaloneIndex]!);
      standaloneIndex += 1;
    }

    const eventKey = getTimelineEventKey(event);
    items.push({
      type: "event",
      key: `event-${eventKey}`,
      createdAt: event.createdAt,
      event
    });

    if (event.kind === "turn_start") {
      items.push(...(usersByTurnStart.get(eventKey) ?? []));
    }
  }

  while (standaloneIndex < standaloneItems.length) {
    items.push(standaloneItems[standaloneIndex]!);
    standaloneIndex += 1;
  }

  return items;
}
