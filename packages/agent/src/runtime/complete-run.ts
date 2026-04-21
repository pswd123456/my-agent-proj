import { createRunCompleteEvent, type RunEventSink } from "../events.js";
import type { SessionManager } from "../session.js";
import type { TraceManager } from "../trace.js";
import type { RunSessionResult, SessionSnapshot } from "../types.js";
import { buildAssistantBlockContent } from "./blocks.js";
import { emitRunEvent, emitTraceEvent } from "./run-events.js";

export async function completeLocally(input: {
  sessionManager: SessionManager;
  traceManager: TraceManager | undefined;
  session: SessionSnapshot;
  turnCount: number;
  loopState: RunSessionResult["status"];
  finalAnswer: string;
  stopReason: string | null;
  toolCallCount: number;
  toolResultCount: number;
  toolOutputs: RunSessionResult["toolOutputs"];
  eventSink: RunEventSink | undefined;
  appendAssistantMessage?: boolean;
}): Promise<RunSessionResult> {
  let session = input.session;

  if (input.appendAssistantMessage ?? true) {
    session = await input.sessionManager.appendBlock(
      input.session.sessionId,
      buildAssistantBlockContent(input.finalAnswer)
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "assistant_text",
        turnCount: input.turnCount,
        text: input.finalAnswer
      }
    });
  }

  session = await input.sessionManager.setPendingToolCallIds(session.sessionId, []);
  session = await input.sessionManager.setLastError(session.sessionId, null);
  session = await input.sessionManager.setLoopState(
    session.sessionId,
    input.loopState
  );
  await emitTraceEvent({
    traceManager: input.traceManager,
    eventSink: input.eventSink,
    sessionId: session.sessionId,
    event: {
      kind: "turn_end",
      turnCount: input.turnCount,
      loopState: input.loopState
    }
  });

  const result = {
    session,
    finalAnswer: input.finalAnswer,
    status: input.loopState,
    stopReason: input.stopReason,
    toolCallCount: input.toolCallCount,
    toolResultCount: input.toolResultCount,
    toolOutputs: input.toolOutputs
  };
  if (input.eventSink) {
    await emitRunEvent(
      input.eventSink,
      createRunCompleteEvent({
        session,
        finalAnswer: input.finalAnswer,
        status: input.loopState,
        stopReason: input.stopReason,
        toolCallCount: input.toolCallCount,
        toolResultCount: input.toolResultCount,
        toolOutputs: input.toolOutputs
      })
    );
  }
  return result;
}
