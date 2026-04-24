import { createRunCompleteEvent, type RunEventSink } from "../events.js";
import type { SessionManager } from "../session.js";
import type { TraceManager } from "../trace.js";
import type { RunSessionResult, SessionSnapshot } from "../types.js";
import { buildAssistantBlockContent } from "./blocks.js";
import { emitRunEvent, emitTraceEvent } from "./run-events.js";

export async function completeInterruptedRun(input: {
  sessionManager: SessionManager;
  traceManager: TraceManager | undefined;
  session: SessionSnapshot;
  turnCount: number;
  toolCallCount: number;
  toolResultCount: number;
  toolOutputs: RunSessionResult["toolOutputs"];
  eventSink: RunEventSink | undefined;
  partialAssistantText?: string | null;
  partialAssistantMessageId?: string | null;
}): Promise<RunSessionResult> {
  let session = input.session;
  const finalAnswer = input.partialAssistantText?.trim() || null;

  if (finalAnswer) {
    session = await input.sessionManager.appendBlock(
      session.sessionId,
      buildAssistantBlockContent(
        finalAnswer,
        input.partialAssistantMessageId ?? undefined
      )
    );
  }

  session = await input.sessionManager.updateContext(session.sessionId, {
    status: "waiting_for_user_input"
  });
  session = await input.sessionManager.setPendingToolCallIds(
    session.sessionId,
    []
  );
  session = await input.sessionManager.setLastError(session.sessionId, null);
  session = await input.sessionManager.setLoopState(
    session.sessionId,
    "interrupted"
  );
  session = await input.sessionManager.saveSession({
    ...session,
    sessionState: {
      ...session.sessionState,
      interruptRequested: false
    }
  });

  await emitTraceEvent({
    traceManager: input.traceManager,
    eventSink: input.eventSink,
    sessionId: session.sessionId,
    event: {
      kind: "interrupted",
      turnCount: input.turnCount,
      stopReason: "interrupted_by_user"
    }
  });
  await emitTraceEvent({
    traceManager: input.traceManager,
    eventSink: input.eventSink,
    sessionId: session.sessionId,
    event: {
      kind: "turn_end",
      turnCount: input.turnCount,
      loopState: "interrupted"
    }
  });

  const result = {
    session,
    finalAnswer,
    status: "interrupted" as const,
    stopReason: "interrupted_by_user" as const,
    toolCallCount: input.toolCallCount,
    toolResultCount: input.toolResultCount,
    toolOutputs: input.toolOutputs
  };

  if (input.eventSink) {
    await emitRunEvent(
      input.eventSink,
      createRunCompleteEvent({
        session,
        finalAnswer,
        status: "interrupted",
        stopReason: "interrupted_by_user",
        toolCallCount: input.toolCallCount,
        toolResultCount: input.toolResultCount,
        toolOutputs: input.toolOutputs
      })
    );
  }

  return result;
}
