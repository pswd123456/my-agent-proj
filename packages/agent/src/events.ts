import type { TraceEvent } from "./trace.js";
import type { LoopState, SessionSnapshot, ToolOutputSummary } from "./types.js";

export interface RunEventBase {
  sessionId: string;
  createdAt: string;
}

export type RunTraceEvent = TraceEvent & RunEventBase;

export interface RunCompleteEvent extends RunEventBase {
  kind: "run_complete";
  finalAnswer: string | null;
  status: LoopState;
  stopReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
  toolOutputs: ToolOutputSummary[];
  session: SessionSnapshot;
}

export interface RunErrorEvent extends RunEventBase {
  kind: "run_error";
  error: string;
  status: LoopState;
  stopReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
  toolOutputs: ToolOutputSummary[];
  session: SessionSnapshot | null;
}

export type RunStreamEvent = RunTraceEvent | RunCompleteEvent | RunErrorEvent;

export type RunEventSink = (
  event: RunStreamEvent
) => void | Promise<void>;

export function createRunTraceEvent(
  sessionId: string,
  event: TraceEvent
): RunTraceEvent {
  return {
    sessionId,
    createdAt: new Date().toISOString(),
    ...structuredClone(event)
  };
}

export function createRunCompleteEvent(input: {
  session: SessionSnapshot;
  finalAnswer: string | null;
  status: LoopState;
  stopReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
  toolOutputs: ToolOutputSummary[];
}): RunCompleteEvent {
  return {
    kind: "run_complete",
    sessionId: input.session.sessionId,
    createdAt: new Date().toISOString(),
    finalAnswer: input.finalAnswer,
    status: input.status,
    stopReason: input.stopReason,
    toolCallCount: input.toolCallCount,
    toolResultCount: input.toolResultCount,
    toolOutputs: structuredClone(input.toolOutputs),
    session: structuredClone(input.session)
  };
}

export function createRunErrorEvent(input: {
  sessionId: string;
  session: SessionSnapshot | null;
  error: string;
  status: LoopState;
  stopReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
  toolOutputs: ToolOutputSummary[];
}): RunErrorEvent {
  return {
    kind: "run_error",
    sessionId: input.sessionId,
    createdAt: new Date().toISOString(),
    error: input.error,
    status: input.status,
    stopReason: input.stopReason,
    toolCallCount: input.toolCallCount,
    toolResultCount: input.toolResultCount,
    toolOutputs: structuredClone(input.toolOutputs),
    session: input.session ? structuredClone(input.session) : null
  };
}
