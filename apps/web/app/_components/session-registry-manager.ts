import {
  type SessionSnapshot,
  type SessionSummary,
  toSessionSummary
} from "@ai-app-template/sdk";
import {
  findReusableNewSessionSummary,
  applyStreamEventToSession,
  mergeSessionSummary,
  sortSessionSummaries
} from "./session-workbench-state";
import type { RunStreamEvent } from "@ai-app-template/sdk";
import type { WorkbenchSessionSummary } from "./session-workbench-types";

export type SessionRegistryState = {
  sessions: WorkbenchSessionSummary[];
  selectedSessionId: string | null;
  currentSession: SessionSnapshot | null;
};

export function createSessionRegistryState(
  currentSession: SessionSnapshot | null = null
): SessionRegistryState {
  return {
    sessions: [],
    selectedSessionId: currentSession?.sessionId ?? null,
    currentSession
  };
}

export function bootstrapSessions(
  snapshots: SessionSnapshot[],
  requestedSessionId: string | null
): SessionRegistryState {
  const sessions = sortSessionSummaries(snapshots, toSessionSummary);
  const fallbackSessionId = sessions[0]?.sessionId ?? null;
  const selectedSessionId = sessions.some(
    (item) => item.sessionId === requestedSessionId
  )
    ? requestedSessionId
    : fallbackSessionId;

  return {
    sessions,
    selectedSessionId,
    currentSession: null
  };
}

export function selectSession(
  state: SessionRegistryState,
  sessionId: string | null
): SessionRegistryState {
  if (state.selectedSessionId === sessionId) {
    return state;
  }

  return {
    ...state,
    selectedSessionId: sessionId,
    currentSession:
      state.currentSession?.sessionId === sessionId
        ? state.currentSession
        : null
  };
}

export function hydrateSelectedSession(
  state: SessionRegistryState,
  session: SessionSnapshot | null
): SessionRegistryState {
  if (!session) {
    return {
      ...state,
      currentSession: null
    };
  }

  return {
    sessions: upsertSessionSummary(state.sessions, session),
    selectedSessionId: session.sessionId,
    currentSession: session
  };
}

export function upsertSession(
  state: SessionRegistryState,
  session: SessionSnapshot
): SessionRegistryState {
  return {
    sessions: upsertSessionSummary(state.sessions, session),
    selectedSessionId:
      state.selectedSessionId === session.sessionId
        ? session.sessionId
        : state.selectedSessionId,
    currentSession:
      state.currentSession?.sessionId === session.sessionId
        ? session
        : state.currentSession
  };
}

export function clearCurrentSession(
  state: SessionRegistryState
): SessionRegistryState {
  if (!state.currentSession) {
    return state;
  }

  return {
    ...state,
    currentSession: null
  };
}

export function applyStreamEventToSessionRegistry(
  state: SessionRegistryState,
  event: RunStreamEvent
): SessionRegistryState {
  const currentSession = state.currentSession;
  if (!currentSession || currentSession.sessionId !== event.sessionId) {
    return state;
  }

  const nextSession = applyStreamEventToSession(currentSession, event);
  return {
    sessions: upsertSessionSummary(state.sessions, nextSession),
    selectedSessionId: nextSession.sessionId,
    currentSession: nextSession
  };
}

export function deleteSession(
  state: SessionRegistryState,
  sessionId: string
): SessionRegistryState {
  const sessions = state.sessions.filter(
    (item) => item.sessionId !== sessionId
  );
  if (state.selectedSessionId !== sessionId) {
    return {
      ...state,
      sessions
    };
  }

  const fallbackSessionId = sessions[0]?.sessionId ?? null;
  return {
    sessions,
    selectedSessionId: fallbackSessionId,
    currentSession:
      state.currentSession?.sessionId === sessionId
        ? null
        : state.currentSession
  };
}

export function replaceSessions(
  state: SessionRegistryState,
  snapshots: SessionSnapshot[]
): SessionRegistryState {
  return {
    ...state,
    sessions: sortSessionSummaries(snapshots, toSessionSummary)
  };
}

export function deriveRenderedSessions(
  state: SessionRegistryState
): WorkbenchSessionSummary[] {
  if (!state.currentSession) {
    return state.sessions;
  }

  return mergeSessionSummary(
    state.sessions,
    state.currentSession,
    toSessionSummary
  );
}

export function reuseOrCreateSessionSummary(
  sessions: SessionSummary[]
): SessionSummary | null {
  return findReusableNewSessionSummary(sessions) ?? null;
}

function upsertSessionSummary(
  sessions: WorkbenchSessionSummary[],
  session: SessionSnapshot
): WorkbenchSessionSummary[] {
  const next = mergeSessionSummary(
    sessions,
    session,
    toSessionSummary
  );
  return [...next];
}
