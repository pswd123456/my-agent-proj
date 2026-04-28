import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import { applyTodoToolResultToSession } from "./session-todo-state";

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
  return {
    ...state,
    session,
    optimisticSessionSnapshot: null,
    interruptingSessionId:
      session && state.interruptingSessionId === session.sessionId
        ? state.interruptingSessionId
        : null
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

  const nextBaseState = {
    ...state,
    optimisticSessionSnapshot: null
  };

  switch (event.kind) {
    case "turn_start":
      return {
        ...nextBaseState,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            ...event.session.sessionState,
            loopState: "running",
            interruptRequested: false
          },
          context: {
            ...current.context,
            status: "running"
          }
        }
      };
    case "tool_call": {
      const nextPending = new Set(current.sessionState.pendingToolCallIds);
      nextPending.add(event.toolCallId);
      return {
        ...nextBaseState,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            loopState: "waiting for tool result",
            pendingToolCallIds: [...nextPending]
          },
          context: {
            ...current.context,
            status: "running"
          }
        }
      };
    }
    case "tool_result": {
      const nextPending = current.sessionState.pendingToolCallIds.filter(
        (id) => id !== event.toolCallId
      );
      const nextSession = applyTodoToolResultToSession(current, event);
      return {
        ...nextBaseState,
        session: {
          ...nextSession,
          sessionState: {
            ...nextSession.sessionState,
            loopState:
              nextPending.length > 0 ? "waiting for tool result" : "running",
            pendingToolCallIds: nextPending
          },
          context: {
            ...nextSession.context,
            status: "running"
          }
        }
      };
    }
    case "permission_request":
      return {
        ...nextBaseState,
        submitting: false,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            loopState: "waiting for input"
          },
          context: {
            ...current.context,
            status: "waiting_for_permission",
            pendingPermissionRequest: event.request
          }
        }
      };
    case "permission_approved": {
      const nextPending = new Set(current.sessionState.pendingToolCallIds);
      nextPending.add(event.toolCallId);
      return {
        ...nextBaseState,
        submitting: false,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            loopState: "running",
            pendingToolCallIds: [...nextPending]
          },
          context: {
            ...current.context,
            status: "running",
            pendingPermissionRequest: null
          }
        }
      };
    }
    case "permission_rejected":
    case "permission_blocked":
      return {
        ...nextBaseState,
        submitting: false,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            loopState: "waiting for input",
            pendingToolCallIds: []
          },
          context: {
            ...current.context,
            status: "waiting_for_user_input",
            pendingPermissionRequest: null
          }
        }
      };
    case "user_question_request":
      return {
        ...nextBaseState,
        submitting: false,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            loopState: "waiting for input",
            pendingToolCallIds: []
          },
          context: {
            ...current.context,
            status: "waiting_for_user_question",
            pendingUserQuestionPayload: event.question
          }
        }
      };
    case "interrupt_requested":
      return {
        ...nextBaseState,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            interruptRequested: true
          }
        }
      };
    case "interrupted":
      return {
        ...nextBaseState,
        submitting: false,
        interruptingSessionId: null,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            loopState: "interrupted",
            interruptRequested: false,
            pendingToolCallIds: []
          },
          context: {
            ...current.context,
            status: "waiting_for_user_input",
            pendingPermissionRequest: null
          }
        }
      };
    case "turn_end":
      return {
        ...nextBaseState,
        submitting:
          event.loopState === "completed" ? state.submitting : false,
        session: {
          ...current,
          sessionState: {
            ...current.sessionState,
            loopState: event.loopState,
            interruptRequested: false,
            pendingToolCallIds:
              event.loopState === "waiting for tool result"
                ? current.sessionState.pendingToolCallIds
                : []
          },
          context: {
            ...current.context,
            status:
              event.loopState === "completed"
                ? "completed"
                : event.loopState === "failed"
                  ? "failed"
                  : event.loopState === "interrupted"
                    ? "waiting_for_user_input"
                    : event.loopState === "waiting for input"
                      ? current.context.pendingUserQuestionPayload
                        ? "waiting_for_user_question"
                        : "waiting_for_user_input"
                      : "running",
            pendingPermissionRequest:
              event.loopState === "waiting for input"
                ? current.context.pendingPermissionRequest
                : null
          }
        }
      };
    case "run_complete":
      return {
        ...nextBaseState,
        interruptingSessionId: null,
        session: event.session
      };
    case "run_error":
      return {
        ...nextBaseState,
        submitting: false,
        interruptingSessionId: null,
        session: "session" in event ? (event.session ?? current) : current
      };
    default:
      return state;
  }
}
