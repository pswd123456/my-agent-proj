import type { RunStreamEvent } from "@ai-app-template/sdk";

import { getTimelineEventKey } from "./session-timeline";

export type PendingUserMessage = {
  createdAt: string;
  text: string;
};

export type RunViewState = {
  streamEvents: RunStreamEvent[];
  recentAssistantEventKeys: Set<string>;
  pendingUserMessage: PendingUserMessage | null;
};

export function createRunViewState(): RunViewState {
  return {
    streamEvents: [],
    recentAssistantEventKeys: new Set(),
    pendingUserMessage: null
  };
}

export function beginRun(
  state: RunViewState,
  message: PendingUserMessage
): RunViewState {
  return {
    streamEvents: [],
    recentAssistantEventKeys: new Set(),
    pendingUserMessage: message
  };
}

export function appendStreamEvent(
  state: RunViewState,
  event: RunStreamEvent
): RunViewState {
  const nextState: RunViewState = {
    ...state,
    streamEvents: [...state.streamEvents, event]
  };

  if (event.kind !== "assistant_text") {
    return nextState;
  }

  const key = getTimelineEventKey(event);
  const recentAssistantEventKeys = new Set(nextState.recentAssistantEventKeys);
  recentAssistantEventKeys.add(key);

  return {
    ...nextState,
    recentAssistantEventKeys
  };
}

export function markAssistantAnimationComplete(
  state: RunViewState,
  key: string
): RunViewState {
  if (!state.recentAssistantEventKeys.has(key)) {
    return state;
  }

  const recentAssistantEventKeys = new Set(state.recentAssistantEventKeys);
  recentAssistantEventKeys.delete(key);

  return {
    ...state,
    recentAssistantEventKeys
  };
}

export function finishRun(state: RunViewState): RunViewState {
  if (!state.pendingUserMessage) {
    return state;
  }

  return {
    ...state,
    pendingUserMessage: null
  };
}

export function resetRunView(): RunViewState {
  return createRunViewState();
}
