import type { TimelineItem } from "./session-timeline";

export interface ConversationScrollSnapshot {
  latestItemKey: string | null;
  latestTurnAnchorKey: string | null;
  latestTurnStartKey: string | null;
}

export type ConversationScrollIntent =
  | "align-latest-turn"
  | "follow-latest-item"
  | "none";

interface ConversationScrollIntentInput {
  previous: ConversationScrollSnapshot | null;
  next: ConversationScrollSnapshot;
  followLatest: boolean;
}

interface ConversationAutoFollowStateInput {
  current: boolean;
  currentScrollTop: number;
  previousScrollTop: number;
  maxScrollTop: number;
  nearEndThresholdPx?: number;
  scrollUpThresholdPx?: number;
}

function isTurnStartItem(item: TimelineItem): boolean {
  return item.type === "event" && item.event.kind === "turn_start";
}

export function buildConversationScrollSnapshot(
  timelineItems: TimelineItem[]
): ConversationScrollSnapshot {
  const latestItem = timelineItems.at(-1) ?? null;
  const latestTurnStartKey =
    [...timelineItems].reverse().find(isTurnStartItem)?.key ?? null;
  const latestTurnAnchorKey =
    latestItem?.type === "pending-user" ? latestItem.key : latestTurnStartKey;

  return {
    latestItemKey: latestItem?.key ?? null,
    latestTurnAnchorKey,
    latestTurnStartKey
  };
}

export function getConversationScrollIntent(
  input: ConversationScrollIntentInput
): ConversationScrollIntent {
  const { previous, next, followLatest } = input;

  if (!followLatest || !next.latestItemKey) {
    return "none";
  }

  if (previous?.latestTurnAnchorKey !== next.latestTurnAnchorKey) {
    return next.latestTurnAnchorKey
      ? "align-latest-turn"
      : "follow-latest-item";
  }

  if (previous?.latestItemKey !== next.latestItemKey) {
    return "follow-latest-item";
  }

  return "none";
}

export function updateConversationAutoFollowState(
  input: ConversationAutoFollowStateInput
): boolean {
  const {
    current,
    currentScrollTop,
    previousScrollTop,
    maxScrollTop,
    nearEndThresholdPx = 40,
    scrollUpThresholdPx = 12
  } = input;

  if (maxScrollTop - currentScrollTop <= nearEndThresholdPx) {
    return true;
  }

  if (currentScrollTop + scrollUpThresholdPx < previousScrollTop) {
    return false;
  }

  return current;
}
