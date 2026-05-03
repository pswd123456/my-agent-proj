import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import {
  appendMessageManagerEvent,
  beginMessageManagerRun,
  completeMessageManagerAutoCollapse,
  createMessageManagerState,
  finishMessageManagerRun,
  markMessageManagerAnimationComplete,
  registerMessageManagerCollapsedFlows,
  resetMessageManagerState,
  resetMessageManagerViewState,
  toggleMessageManagerExpanded,
  type MessageManagerState,
  type PendingPreUserHooks,
  type PendingUserMessage
} from "./session-message-manager";
import {
  applyStreamEventToSessionState,
  beginSessionInterrupt,
  beginSessionSubmission,
  clearSessionUiState,
  createSessionUiState,
  finishSessionSubmission,
  rollbackSessionUiState,
  setSessionSnapshot,
  type SessionUiState
} from "./session-state-manager";
import {
  buildRunFileChangesStatesFromSession,
  mergeRunFileChangesStates,
  type RunFileChangesState
} from "./session-run-file-changes";

export interface SessionLocalStateBucket {
  uiState: SessionUiState;
  messageManagerState: MessageManagerState;
  runFileChanges: RunFileChangesState[];
}

export type SessionLocalStateMap = Record<string, SessionLocalStateBucket>;

function createSessionLocalStateBucket(
  session: SessionSnapshot | null = null
): SessionLocalStateBucket {
  return {
    uiState: createSessionUiState(session),
    messageManagerState: createMessageManagerState(),
    runFileChanges: buildRunFileChangesStatesFromSession(session)
  };
}

export function createSessionLocalStateMap(): SessionLocalStateMap {
  return {};
}

export function getSessionLocalStateBucket(
  map: SessionLocalStateMap,
  sessionId: string | null
): SessionLocalStateBucket | null {
  if (!sessionId) {
    return null;
  }

  return map[sessionId] ?? null;
}

function ensureSessionLocalStateBucket(
  map: SessionLocalStateMap,
  sessionId: string,
  session: SessionSnapshot | null = null
): SessionLocalStateBucket {
  return map[sessionId] ?? createSessionLocalStateBucket(session);
}

export function upsertSessionLocalState(
  map: SessionLocalStateMap,
  session: SessionSnapshot
): SessionLocalStateMap {
  const current = ensureSessionLocalStateBucket(map, session.sessionId, session);
  return {
    ...map,
    [session.sessionId]: {
      ...current,
      uiState: setSessionSnapshot(current.uiState, session),
      runFileChanges: mergeRunFileChangesStates(
        current.runFileChanges,
        buildRunFileChangesStatesFromSession(session)
      )
    }
  };
}

export function removeSessionLocalState(
  map: SessionLocalStateMap,
  sessionId: string
): SessionLocalStateMap {
  if (!map[sessionId]) {
    return map;
  }

  const { [sessionId]: _removed, ...rest } = map;
  return rest;
}

export function clearSessionLocalState(
  map: SessionLocalStateMap,
  sessionId: string
): SessionLocalStateMap {
  const current = map[sessionId];
  if (!current) {
    return map;
  }

  return {
    ...map,
    [sessionId]: {
      ...current,
      uiState: clearSessionUiState(current.uiState),
      messageManagerState: resetMessageManagerState(),
      runFileChanges: []
    }
  };
}

export function beginSessionLocalSubmission(input: {
  map: SessionLocalStateMap;
  session: SessionSnapshot;
  pendingUserMessage: PendingUserMessage;
  pendingPreUserHooks?: PendingPreUserHooks | null;
  permissionReply?: boolean;
}): SessionLocalStateMap {
  const current = ensureSessionLocalStateBucket(
    input.map,
    input.session.sessionId,
    input.session
  );
  return {
    ...input.map,
    [input.session.sessionId]: {
      ...current,
      uiState: beginSessionSubmission(setSessionSnapshot(current.uiState, input.session)),
      messageManagerState:
        input.permissionReply === true
          ? current.messageManagerState
          : beginMessageManagerRun(current.messageManagerState, {
              message: input.pendingUserMessage,
              pendingPreUserHooks: input.pendingPreUserHooks ?? null
            })
    }
  };
}

export function rollbackSessionLocalSubmission(
  map: SessionLocalStateMap,
  sessionId: string
): SessionLocalStateMap {
  const current = map[sessionId];
  if (!current) {
    return map;
  }

  return {
    ...map,
    [sessionId]: {
      ...current,
      uiState: rollbackSessionUiState(current.uiState, sessionId)
    }
  };
}

export function finishSessionLocalSubmission(
  map: SessionLocalStateMap,
  sessionId: string
): SessionLocalStateMap {
  const current = map[sessionId];
  if (!current) {
    return map;
  }

  return {
    ...map,
    [sessionId]: {
      ...current,
      uiState: finishSessionSubmission(current.uiState, sessionId),
      messageManagerState: finishMessageManagerRun(current.messageManagerState)
    }
  };
}

export function beginSessionLocalInterrupt(
  map: SessionLocalStateMap,
  sessionId: string
): SessionLocalStateMap {
  const current = map[sessionId];
  if (!current) {
    return map;
  }

  return {
    ...map,
    [sessionId]: {
      ...current,
      uiState: beginSessionInterrupt(current.uiState, sessionId)
    }
  };
}

export function applyStreamEventToSessionLocalState(
  map: SessionLocalStateMap,
  event: RunStreamEvent
): SessionLocalStateMap {
  const current = map[event.sessionId];
  if (!current) {
    return map;
  }

  const nextBucket: SessionLocalStateBucket = {
    ...current,
    uiState: applyStreamEventToSessionState(current.uiState, event),
    messageManagerState: appendMessageManagerEvent(
      current.messageManagerState,
      event
    )
  };

  if (
    (event.kind === "run_complete" || event.kind === "run_error") &&
    "session" in event &&
    event.session
  ) {
    nextBucket.runFileChanges = mergeRunFileChangesStates(
      current.runFileChanges,
      buildRunFileChangesStatesFromSession(event.session)
    );
  }

  return {
    ...map,
    [event.sessionId]: nextBucket
  };
}

export function setRunFileChangesForSession(
  map: SessionLocalStateMap,
  sessionId: string,
  updater: (current: RunFileChangesState[]) => RunFileChangesState[]
): SessionLocalStateMap {
  const current = map[sessionId];
  if (!current) {
    return map;
  }

  return {
    ...map,
    [sessionId]: {
      ...current,
      runFileChanges: updater(current.runFileChanges)
    }
  };
}

export function setMessageManagerStateForSession(
  map: SessionLocalStateMap,
  sessionId: string,
  updater: (current: MessageManagerState) => MessageManagerState
): SessionLocalStateMap {
  const current = map[sessionId];
  if (!current) {
    return map;
  }

  return {
    ...map,
    [sessionId]: {
      ...current,
      messageManagerState: updater(current.messageManagerState)
    }
  };
}

export function markAssistantAnimationCompleteForSession(
  map: SessionLocalStateMap,
  sessionId: string,
  itemKey: string
): SessionLocalStateMap {
  return setMessageManagerStateForSession(map, sessionId, (current) =>
    markMessageManagerAnimationComplete(current, itemKey)
  );
}

export function resetMessageManagerViewStateForSession(
  map: SessionLocalStateMap,
  sessionId: string
): SessionLocalStateMap {
  return setMessageManagerStateForSession(map, sessionId, (current) =>
    resetMessageManagerViewState(current)
  );
}

export function registerCollapsedFlowsForSession(
  map: SessionLocalStateMap,
  sessionId: string,
  keys: string[]
): SessionLocalStateMap {
  return setMessageManagerStateForSession(map, sessionId, (current) =>
    registerMessageManagerCollapsedFlows(current, keys)
  );
}

export function toggleExpandedItemForSession(
  map: SessionLocalStateMap,
  sessionId: string,
  key: string
): SessionLocalStateMap {
  return setMessageManagerStateForSession(map, sessionId, (current) =>
    toggleMessageManagerExpanded(current, key)
  );
}

export function completeAutoCollapseForSession(
  map: SessionLocalStateMap,
  sessionId: string,
  key: string
): SessionLocalStateMap {
  return setMessageManagerStateForSession(map, sessionId, (current) =>
    completeMessageManagerAutoCollapse(current, key)
  );
}
