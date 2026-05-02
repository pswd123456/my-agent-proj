import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import { applyStreamEventToSession } from "./session-workbench-state";

export interface SessionUiState {
  session: SessionSnapshot | null;
  submitting: boolean;
  interruptingSessionId: string | null;
  optimisticSessionSnapshot: SessionSnapshot | null;
}

export function createSessionUiState(
  session: SessionSnapshot | null
): SessionUiState {
  return {
    session,
    submitting: false,
    interruptingSessionId: null,
    optimisticSessionSnapshot: null
  };
}

export function setSessionSnapshot(
  state: SessionUiState,
  session: SessionSnapshot | null
): SessionUiState {
  const interrupted = session?.sessionState.loopState === "interrupted";

  return {
    ...state,
    session,
    submitting: interrupted ? false : state.submitting,
    optimisticSessionSnapshot: null,
    interruptingSessionId:
      session &&
      state.interruptingSessionId === session.sessionId &&
      session.sessionState.interruptRequested
        ? state.interruptingSessionId
        : null
  };
}

export function clearSessionUiState(state: SessionUiState): SessionUiState {
  if (
    state.session === null &&
    state.submitting === false &&
    state.interruptingSessionId === null &&
    state.optimisticSessionSnapshot === null
  ) {
    return state;
  }

  return {
    session: null,
    submitting: false,
    interruptingSessionId: null,
    optimisticSessionSnapshot: null
  };
}

export function beginSessionSubmission(state: SessionUiState): SessionUiState {
  if (!state.session) {
    return state;
  }

  return {
    ...state,
    submitting: true,
    interruptingSessionId: null,
    optimisticSessionSnapshot:
      state.optimisticSessionSnapshot ?? structuredClone(state.session),
    session: {
      ...state.session,
      context: {
        ...state.session.context,
        status: "running",
        pendingPermissionRequest: null,
        pendingUserQuestionPayload: null
      },
      sessionState: {
        ...state.session.sessionState,
        loopState: "running",
        interruptRequested: false
      }
    }
  };
}

export function finishSessionSubmission(
  state: SessionUiState,
  sessionId: string
): SessionUiState {
  return {
    ...state,
    submitting: false,
    optimisticSessionSnapshot:
      state.optimisticSessionSnapshot?.sessionId === sessionId
        ? null
        : state.optimisticSessionSnapshot,
    interruptingSessionId:
      state.interruptingSessionId === sessionId
        ? null
        : state.interruptingSessionId
  };
}

export function beginSessionInterrupt(
  state: SessionUiState,
  sessionId: string
): SessionUiState {
  if (!state.session || state.session.sessionId !== sessionId) {
    return {
      ...state,
      interruptingSessionId: sessionId
    };
  }

  return {
    ...state,
    interruptingSessionId: sessionId,
    optimisticSessionSnapshot:
      state.optimisticSessionSnapshot ?? structuredClone(state.session),
    session: {
      ...state.session,
      sessionState: {
        ...state.session.sessionState,
        interruptRequested: true
      }
    }
  };
}

export function rollbackSessionUiState(
  state: SessionUiState,
  sessionId: string
): SessionUiState {
  const optimisticSession = state.optimisticSessionSnapshot;
  if (!optimisticSession || optimisticSession.sessionId !== sessionId) {
    return {
      ...state,
      submitting: false,
      interruptingSessionId:
        state.interruptingSessionId === sessionId
          ? null
          : state.interruptingSessionId
    };
  }

  return {
    ...state,
    session: optimisticSession,
    submitting: false,
    interruptingSessionId: null,
    optimisticSessionSnapshot: null
  };
}

export function applyStreamEventToSessionState(
  state: SessionUiState,
  event: RunStreamEvent
): SessionUiState {
  const current = state.session;
  if (!current || current.sessionId !== event.sessionId) {
    return state;
  }

  const applySessionReducer = () => ({
    ...state,
    session: applyStreamEventToSession(current, event),
    optimisticSessionSnapshot: null
  });

  switch (event.kind) {
    case "turn_start":
    case "tool_call":
    case "tool_result":
    case "interrupt_requested":
      return applySessionReducer();
    case "permission_request":
      return {
        ...applySessionReducer(),
        submitting: false
      };
    case "permission_approved":
    case "permission_rejected":
    case "permission_blocked":
      return {
        ...applySessionReducer(),
        submitting: false
      };
    case "user_question_request":
      return {
        ...applySessionReducer(),
        submitting: false
      };
    case "interrupted":
      return {
        ...applySessionReducer(),
        submitting: false,
        interruptingSessionId: null
      };
    case "turn_end":
      return {
        ...applySessionReducer(),
        submitting: event.loopState === "completed" ? state.submitting : false
      };
    case "run_complete":
      return {
        ...applySessionReducer(),
        interruptingSessionId: null
      };
    case "run_error":
      return {
        ...applySessionReducer(),
        submitting: false,
        interruptingSessionId: null
      };
    default:
      return state;
  }
}
