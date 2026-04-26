import type { SessionManager } from "../session.js";
import type { SessionSnapshot } from "../types.js";

export async function handlePendingUserQuestionReply(input: {
  sessionManager: SessionManager;
  session: SessionSnapshot;
}): Promise<SessionSnapshot> {
  return input.sessionManager.updateContext(input.session.sessionId, {
    status: "running",
    pendingUserQuestionPayload: null
  });
}
