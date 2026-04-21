import {
  createRunTraceEvent,
  type RunEventSink
} from "../events.js";
import type { TraceEvent, TraceManager } from "../trace.js";

export async function appendTrace(
  traceManager: TraceManager | undefined,
  sessionId: string,
  event: Parameters<TraceManager["appendEvent"]>[1]
): Promise<void> {
  if (!traceManager) {
    return;
  }

  await traceManager.appendEvent(sessionId, event);
}

export async function emitRunEvent(
  eventSink: RunEventSink | undefined,
  event: Parameters<RunEventSink>[0]
): Promise<void> {
  if (!eventSink) {
    return;
  }

  try {
    await eventSink(event);
  } catch {
    // Stream transport failures should not change session correctness.
  }
}

export async function emitTraceEvent(input: {
  traceManager: TraceManager | undefined;
  eventSink: RunEventSink | undefined;
  sessionId: string;
  event: TraceEvent;
}): Promise<void> {
  await appendTrace(input.traceManager, input.sessionId, input.event);
  await emitRunEvent(
    input.eventSink,
    createRunTraceEvent(input.sessionId, input.event)
  );
}
