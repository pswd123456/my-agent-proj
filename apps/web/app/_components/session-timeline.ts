import type {
  RunStreamEvent,
  SessionSnapshot,
  UserContextHookRecord
} from "@ai-app-template/sdk";

export interface TimelineUserHookMetadata {
  event: UserContextHookRecord["event"];
  title: string;
}

export interface TimelinePendingHookRun {
  createdAt: string;
  hooks: TimelineUserHookMetadata[];
}

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
      userHook?: TimelineUserHookMetadata;
    }
  | {
      type: "pending-user";
      key: string;
      createdAt: string;
      text: string;
    }
  | {
      type: "pending-hook";
      key: string;
      createdAt: string;
      hookRun: TimelinePendingHookRun;
    };

interface PendingUserMessage {
  text: string;
  createdAt: string;
}

type MessageHookMetadataByContent = Map<string, TimelineUserHookMetadata>;

function hasPersistedMatchForPendingUser(input: {
  messages: SessionSnapshot["messages"];
  pendingUserMessage: PendingUserMessage | null | undefined;
}): boolean {
  const { messages, pendingUserMessage } = input;
  if (!pendingUserMessage) {
    return false;
  }

  const pendingText = pendingUserMessage.text.trim();
  if (pendingText.length === 0) {
    return false;
  }

  return messages.some(
    (
      block
    ): block is Extract<
      SessionSnapshot["messages"][number],
      { kind: "user" }
    > =>
      block.kind === "user" &&
      block.createdAt >= pendingUserMessage.createdAt &&
      block.content.trim() === pendingText
  );
}

function isVisibleTimelineEvent(event: RunStreamEvent): boolean {
  if (event.kind === "assistant_text" && event.text.trim().length === 0) {
    return false;
  }

  return (
    event.kind !== "prompt" &&
    event.kind !== "response" &&
    event.kind !== "skills_loaded" &&
    event.kind !== "context_hooks_loaded" &&
    event.kind !== "hook_subagent_scheduled" &&
    event.kind !== "hook_context_materialized" &&
    event.kind !== "workspace_instructions_loaded" &&
    event.kind !== "mcp_loaded" &&
    event.kind !== "user_question_request" &&
    event.kind !== "interrupt_requested" &&
    event.kind !== "interrupted"
  );
}

function isPermissionTimelineEvent(
  event: RunStreamEvent
): event is Extract<
  RunStreamEvent,
  | { kind: "permission_request" }
  | { kind: "permission_approved" }
  | { kind: "permission_rejected" }
> {
  return (
    event.kind === "permission_request" ||
    event.kind === "permission_approved" ||
    event.kind === "permission_rejected"
  );
}

function getEventSortOrder(event: RunStreamEvent): number {
  switch (event.kind) {
    case "turn_start":
      return 0;
    case "thinking":
      return 1;
    case "tool_call":
      return 2;
    case "permission_request":
      return 3;
    case "permission_approved":
      return 4;
    case "permission_rejected":
      return 5;
    case "permission_blocked":
      return 6;
    case "tool_result":
      return 7;
    case "background_notification":
      return 8;
    case "background_notification_consumed":
      return 9;
    case "assistant_text":
      return 10;
    case "user_question_request":
      return 11;
    case "interrupt_requested":
      return 12;
    case "interrupted":
      return 13;
    case "fallback":
      return 14;
    case "run_error":
      return 15;
    case "run_complete":
      return 16;
    case "turn_end":
      return 17;
    default:
      return 15;
  }
}

function isToolFlowEvent(event: RunStreamEvent): boolean {
  return (
    event.kind === "tool_call" ||
    event.kind === "permission_request" ||
    event.kind === "permission_approved" ||
    event.kind === "permission_rejected" ||
    event.kind === "permission_blocked" ||
    event.kind === "tool_result" ||
    event.kind === "background_notification" ||
    event.kind === "background_notification_consumed"
  );
}

function getDefaultNarrativePhaseOrder(event: RunStreamEvent): number {
  switch (event.kind) {
    case "turn_start":
      return 0;
    case "thinking":
      return 1;
    case "assistant_text":
      return 4;
    case "tool_call":
    case "permission_request":
    case "permission_approved":
    case "permission_rejected":
    case "permission_blocked":
    case "tool_result":
    case "background_notification":
    case "background_notification_consumed":
      return 3;
    case "user_question_request":
      return 5;
    case "interrupt_requested":
    case "interrupted":
      return 6;
    case "fallback":
      return 7;
    case "run_error":
      return 8;
    case "run_complete":
      return 9;
    case "turn_end":
      return 10;
    default:
      return 9;
  }
}

function getEventTurnCount(event: RunStreamEvent): number | null {
  return "turnCount" in event ? event.turnCount : null;
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

function inferHookBehavior(
  hook: UserContextHookRecord
): UserContextHookRecord["behavior"] {
  return hook.behavior ?? (hook.event === "run_end" ? "message" : "context");
}

function buildMessageHookMetadataByContent(
  hooks: UserContextHookRecord[] | undefined
): MessageHookMetadataByContent {
  const metadataByContent: MessageHookMetadataByContent = new Map();

  for (const hook of hooks ?? []) {
    const content = hook.content.trim();
    if (!hook.enabled || inferHookBehavior(hook) !== "message" || !content) {
      continue;
    }

    if (!metadataByContent.has(content)) {
      metadataByContent.set(content, {
        event: hook.event,
        title: hook.title.trim()
      });
    }
  }

  return metadataByContent;
}

function getUserHookMetadata(
  block: SessionSnapshot["messages"][number],
  metadataByContent: MessageHookMetadataByContent
): TimelineUserHookMetadata | undefined {
  if (block.kind !== "user") {
    return undefined;
  }

  return metadataByContent.get(block.content.trim());
}

function toMessageTimelineItem(
  block: SessionSnapshot["messages"][number],
  metadataByContent: MessageHookMetadataByContent
): Extract<TimelineItem, { type: "message" }> {
  const userHook = getUserHookMetadata(block, metadataByContent);

  return {
    type: "message",
    key: `message-${block.id}`,
    createdAt: block.createdAt,
    block,
    ...(userHook ? { userHook } : {})
  };
}

function getPreUserHookMetadata(item: TimelineItem) {
  return item.type === "message" &&
    item.block.kind === "user" &&
    item.userHook &&
    item.userHook.event !== "run_end"
    ? item.userHook
    : null;
}

function getPostUserHookMetadata(item: TimelineItem) {
  return item.type === "message" &&
    item.block.kind === "user" &&
    item.userHook?.event === "run_end"
    ? item.userHook
    : null;
}

function compareTimelineItems(
  left: TimelineItem,
  right: TimelineItem,
  pendingUserMessage: PendingUserMessage | null | undefined
): number {
  if (!pendingUserMessage) {
    return compareByCreatedAt(left, right);
  }

  const pendingKey = `pending-user-${pendingUserMessage.createdAt}`;
  const leftIsPending = left.type === "pending-user" && left.key === pendingKey;
  const rightIsPending =
    right.type === "pending-user" && right.key === pendingKey;

  if (leftIsPending && !rightIsPending) {
    if (
      getPreUserHookMetadata(right) &&
      right.createdAt >= pendingUserMessage.createdAt
    ) {
      return 1;
    }

    if (
      getPostUserHookMetadata(right) &&
      right.createdAt >= pendingUserMessage.createdAt
    ) {
      return -1;
    }
  }

  if (rightIsPending && !leftIsPending) {
    if (
      getPreUserHookMetadata(left) &&
      left.createdAt >= pendingUserMessage.createdAt
    ) {
      return -1;
    }

    if (
      getPostUserHookMetadata(left) &&
      left.createdAt >= pendingUserMessage.createdAt
    ) {
      return 1;
    }
  }

  return compareByCreatedAt(left, right);
}

function isCurrentPendingUserItem(
  item: TimelineItem,
  pendingUserMessage: PendingUserMessage | null | undefined
): boolean {
  if (!pendingUserMessage) {
    return false;
  }

  return (
    item.type === "pending-user" &&
    item.key === `pending-user-${pendingUserMessage.createdAt}`
  );
}

function hasCurrentPreUserHookItems(
  items: TimelineItem[],
  pendingUserMessage: PendingUserMessage | null | undefined
): boolean {
  if (!pendingUserMessage) {
    return false;
  }

  return items.some(
    (item) =>
      Boolean(getPreUserHookMetadata(item)) &&
      item.createdAt >= pendingUserMessage.createdAt
  );
}

function compareEventsChronologically(
  left: RunStreamEvent,
  right: RunStreamEvent
): number {
  if (left.createdAt === right.createdAt) {
    return (
      getEventSortOrder(left) - getEventSortOrder(right) ||
      getTimelineEventKey(left).localeCompare(getTimelineEventKey(right))
    );
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function buildEventTurnSequenceByKey(
  events: RunStreamEvent[]
): Map<string, number> {
  const turnSequenceByKey = new Map<string, number>();
  let currentTurnSequence = -1;
  let lastSeenTurnCount: number | null = null;

  for (const event of events) {
    const eventTurnCount = getEventTurnCount(event);
    const turnCountAdvanced =
      eventTurnCount !== null &&
      lastSeenTurnCount !== null &&
      eventTurnCount > lastSeenTurnCount;

    if (event.kind === "turn_start" || turnCountAdvanced) {
      currentTurnSequence += 1;
    } else if (currentTurnSequence < 0) {
      currentTurnSequence = 0;
    }

    turnSequenceByKey.set(getTimelineEventKey(event), currentTurnSequence);

    if (eventTurnCount !== null) {
      lastSeenTurnCount = eventTurnCount;
    }
  }

  return turnSequenceByKey;
}

function buildNarrativePhaseByKey(
  events: RunStreamEvent[],
  turnSequenceByKey: Map<string, number>
): Map<string, number> {
  const phaseByKey = new Map<string, number>();
  const seenToolFlowByTurn = new Map<number, boolean>();
  const hasLaterToolCallByKey = new Map<string, boolean>();
  const seenFutureToolCallByTurn = new Map<number, boolean>();

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    const eventKey = getTimelineEventKey(event);
    const turnSequence =
      turnSequenceByKey.get(eventKey) ?? Number.MAX_SAFE_INTEGER;

    if (event.kind === "assistant_text") {
      hasLaterToolCallByKey.set(
        eventKey,
        seenFutureToolCallByTurn.get(turnSequence) ?? false
      );
    }

    if (event.kind === "tool_call") {
      seenFutureToolCallByTurn.set(turnSequence, true);
    }
  }

  for (const event of events) {
    const eventKey = getTimelineEventKey(event);
    const turnSequence =
      turnSequenceByKey.get(eventKey) ?? Number.MAX_SAFE_INTEGER;

    if (event.kind === "assistant_text") {
      const seenToolFlow = seenToolFlowByTurn.get(turnSequence) ?? false;
      const hasLaterToolCall = hasLaterToolCallByKey.get(eventKey) ?? false;
      phaseByKey.set(eventKey, !seenToolFlow && hasLaterToolCall ? 2 : 4);
      continue;
    }

    phaseByKey.set(eventKey, getDefaultNarrativePhaseOrder(event));

    if (isToolFlowEvent(event)) {
      seenToolFlowByTurn.set(turnSequence, true);
    }
  }

  return phaseByKey;
}

function compareEventsForTimeline(
  left: RunStreamEvent,
  right: RunStreamEvent,
  turnSequenceByKey: Map<string, number>,
  narrativePhaseByKey: Map<string, number>
): number {
  const leftTurnSequence =
    turnSequenceByKey.get(getTimelineEventKey(left)) ?? Number.MAX_SAFE_INTEGER;
  const rightTurnSequence =
    turnSequenceByKey.get(getTimelineEventKey(right)) ??
    Number.MAX_SAFE_INTEGER;

  if (leftTurnSequence === rightTurnSequence) {
    const leftNarrativePhase =
      narrativePhaseByKey.get(getTimelineEventKey(left)) ??
      getDefaultNarrativePhaseOrder(left);
    const rightNarrativePhase =
      narrativePhaseByKey.get(getTimelineEventKey(right)) ??
      getDefaultNarrativePhaseOrder(right);
    if (leftNarrativePhase !== rightNarrativePhase) {
      return leftNarrativePhase - rightNarrativePhase;
    }
  }

  if (leftTurnSequence !== rightTurnSequence) {
    return leftTurnSequence - rightTurnSequence;
  }

  return compareEventsChronologically(left, right);
}

function buildMessageTimeline(
  messages: SessionSnapshot["messages"],
  pendingUserMessage: PendingUserMessage | null | undefined,
  metadataByContent: MessageHookMetadataByContent,
  pendingHookRun: TimelinePendingHookRun | null | undefined
): TimelineItem[] {
  const items: TimelineItem[] = messages.map((block) =>
    toMessageTimelineItem(block, metadataByContent)
  );

  if (pendingHookRun) {
    items.push({
      type: "pending-hook",
      key: `pending-hook-${pendingHookRun.createdAt}`,
      createdAt: pendingHookRun.createdAt,
      hookRun: pendingHookRun
    });
  }

  if (
    pendingUserMessage &&
    !hasPersistedMatchForPendingUser({ messages, pendingUserMessage })
  ) {
    items.push({
      type: "pending-user",
      key: `pending-user-${pendingUserMessage.createdAt}`,
      createdAt: pendingUserMessage.createdAt,
      text: pendingUserMessage.text
    });
  }

  return items.sort((left, right) =>
    compareTimelineItems(left, right, pendingUserMessage)
  );
}

function matchesConversationBlock(
  block: SessionSnapshot["messages"][number],
  event: RunStreamEvent
): boolean {
  if (block.kind === "assistant" && event.kind === "assistant_text") {
    return (
      block.id === event.assistantMessageId ||
      block.content === (event.snapshot ?? event.text)
    );
  }

  if (block.kind === "assistant thinking" && event.kind === "thinking") {
    return block.signature === event.signature || block.content === event.text;
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
  if (event.kind === "assistant_text") {
    return `${event.kind}-${event.assistantMessageId}`;
  }

  if (event.kind === "thinking") {
    const stableId = event.thinkingMessageId ?? event.signature;
    return stableId
      ? `${event.kind}-${stableId}`
      : `${event.kind}-${event.createdAt}`;
  }

  if (
    event.kind === "tool_call" ||
    event.kind === "tool_result" ||
    event.kind === "permission_request" ||
    event.kind === "permission_approved" ||
    event.kind === "permission_rejected" ||
    event.kind === "permission_blocked"
  ) {
    return `${event.kind}-${event.toolCallId}-${event.createdAt}`;
  }

  if (
    event.kind === "background_notification" ||
    event.kind === "background_notification_consumed"
  ) {
    return `${event.kind}-${event.notification.id}`;
  }

  if (event.kind === "run_complete" || event.kind === "run_error") {
    return `${event.kind}-${event.createdAt}-${event.sessionId}`;
  }

  return `${event.kind}-${event.createdAt}`;
}

export function getTimelineEventRenderKey(event: RunStreamEvent): string {
  if (event.kind === "assistant_text") {
    return `${event.kind}-${event.assistantMessageId}-${event.createdAt}`;
  }

  if (event.kind === "thinking") {
    const stableId = event.thinkingMessageId ?? event.signature;
    return stableId
      ? `${event.kind}-${stableId}-${event.createdAt}`
      : `${event.kind}-${event.createdAt}`;
  }

  return getTimelineEventKey(event);
}

export function buildTimelineItems(input: {
  messages: SessionSnapshot["messages"];
  historyEvents: RunStreamEvent[];
  streamEvents: RunStreamEvent[];
  pendingUserMessage?: PendingUserMessage | null;
  userContextHooks?: UserContextHookRecord[];
  pendingHookRun?: TimelinePendingHookRun | null;
}): TimelineItem[] {
  const metadataByContent = buildMessageHookMetadataByContent(
    input.userContextHooks
  );
  const visibleEventsByKey = new Map<string, RunStreamEvent>();
  const permissionEventKeysByToolCallId = new Map<string, string>();

  for (const event of [...input.historyEvents, ...input.streamEvents]) {
    if (!isVisibleTimelineEvent(event)) {
      continue;
    }

    if (isPermissionTimelineEvent(event)) {
      const previousKey = permissionEventKeysByToolCallId.get(event.toolCallId);
      if (previousKey) {
        const previous = visibleEventsByKey.get(previousKey);
        if (previous && compareEventsChronologically(previous, event) <= 0) {
          visibleEventsByKey.delete(previousKey);
          const nextKey = getTimelineEventKey(event);
          permissionEventKeysByToolCallId.set(event.toolCallId, nextKey);
          visibleEventsByKey.set(nextKey, event);
        }

        continue;
      }

      const nextKey = getTimelineEventKey(event);
      permissionEventKeysByToolCallId.set(event.toolCallId, nextKey);
      visibleEventsByKey.set(nextKey, event);
      continue;
    }

    visibleEventsByKey.set(getTimelineEventKey(event), event);
  }

  const chronologicalEvents = [...visibleEventsByKey.values()].sort(
    compareEventsChronologically
  );
  const turnSequenceByKey = buildEventTurnSequenceByKey(chronologicalEvents);
  const narrativePhaseByKey = buildNarrativePhaseByKey(
    chronologicalEvents,
    turnSequenceByKey
  );
  const visibleEvents = [...chronologicalEvents].sort((left, right) =>
    compareEventsForTimeline(
      left,
      right,
      turnSequenceByKey,
      narrativePhaseByKey
    )
  );

  if (visibleEvents.length === 0) {
    return buildMessageTimeline(
      input.messages,
      input.pendingUserMessage,
      metadataByContent,
      input.pendingHookRun
    );
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
    .map((block) => toMessageTimelineItem(block, metadataByContent));

  if (
    input.pendingUserMessage &&
    !hasPersistedMatchForPendingUser({
      messages: input.messages,
      pendingUserMessage: input.pendingUserMessage
    })
  ) {
    userItems.push({
      type: "pending-user",
      key: `pending-user-${input.pendingUserMessage.createdAt}`,
      createdAt: input.pendingUserMessage.createdAt,
      text: input.pendingUserMessage.text
    });
  }

  userItems.sort((left, right) =>
    compareTimelineItems(left, right, input.pendingUserMessage)
  );

  const turnStartEvents = visibleEvents.filter(
    (event): event is Extract<RunStreamEvent, { kind: "turn_start" }> =>
      event.kind === "turn_start"
  );
  const usersByTurnStart = new Map<string, TimelineItem[]>();
  const orphanUsers: TimelineItem[] = [];
  const shouldDeferPendingUser = hasCurrentPreUserHookItems(
    userItems,
    input.pendingUserMessage
  );
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
      if (
        shouldDeferPendingUser &&
        isCurrentPendingUserItem(userItem, input.pendingUserMessage)
      ) {
        continue;
      }

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
    ...(input.pendingHookRun
      ? [
          {
            type: "pending-hook" as const,
            key: `pending-hook-${input.pendingHookRun.createdAt}`,
            createdAt: input.pendingHookRun.createdAt,
            hookRun: input.pendingHookRun
          }
        ]
      : []),
    ...orphanUsers,
    ...input.messages
      .filter(
        (block) => block.kind !== "user" && !consumedMessageIds.has(block.id)
      )
      .map((block) => toMessageTimelineItem(block, metadataByContent))
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
