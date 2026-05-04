import { describe, expect, test } from "bun:test";

import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";

describe("session force stop", () => {
  test("repairs the visible session state and lets the interrupted run observe cancellation", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      userId: "force-stop-user"
    });
    const runId = "run-force-stop-1";

    const acquired = await sessionManager.acquireExecution(session.sessionId, {
      runId
    });
    expect(acquired).not.toBeNull();
    await sessionManager.setLoopState(session.sessionId, "running");
    const controller = new AbortController();
    sessionManager.registerExecutionAbort(session.sessionId, runId, controller);

    const stopped = await sessionManager.forceStop(session.sessionId);

    expect(stopped?.context.status).toBe("waiting_for_user_input");
    expect(stopped?.sessionState.loopState).toBe("interrupted");
    expect(stopped?.sessionState.pendingToolCallIds).toEqual([]);
    expect(stopped?.sessionState.interruptRequested).toBe(false);
    expect(await sessionManager.isExecutionActive(session.sessionId)).toBe(
      false
    );
    expect(
      await sessionManager.isInterruptRequested(session.sessionId, runId)
    ).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    const nextRun = await sessionManager.acquireExecution(session.sessionId, {
      runId: "run-force-stop-2"
    });
    expect(nextRun).not.toBeNull();
  });
});
