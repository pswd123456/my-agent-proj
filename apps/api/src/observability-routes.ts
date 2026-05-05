import type { SessionSnapshot } from "@ai-app-template/agent";

import type { ApiApp, ApiAppDependencies } from "./app-context.js";
import {
  getRequestId,
  listRoutinesQuerySchema,
  logApiEvent,
  recoverSessionBodySchema,
  systemLogsQuerySchema
} from "./app-shared.js";

export function registerObservabilityRoutes(input: {
  app: ApiApp;
  dependencies: ApiAppDependencies;
}) {
  const { app, dependencies } = input;

  app.get("/system-logs", async (c) => {
    const requestId = getRequestId(c);
    const query = systemLogsQuerySchema.parse(c.req.query());
    const result = await dependencies.systemLogManager.query({
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.component ? { component: query.component } : {}),
      ...(query.event ? { event: query.event } : {}),
      ...(query.runId ? { runId: query.runId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(typeof query.limit === "number" ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {})
    });
    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "system_logs_read",
      details: {
        sessionId: query.sessionId ?? null,
        level: query.level ?? null,
        component: query.component ?? null,
        event: query.event ?? null,
        runId: query.runId ?? null,
        recordRequestId: query.requestId ?? null,
        returned: result.records.length
      }
    });
    return c.json(result);
  });

  app.get("/sessions/:sessionId/trace", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const events = await dependencies.traceManager.readEvents(sessionId);
    return c.json({ sessionId, events });
  });

  app.get("/sessions/:sessionId/routines", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const query = listRoutinesQuerySchema.parse(c.req.query());
    const routines = await dependencies.routineRepository.listByDateRange(
      query.startDate,
      query.endDate
    );

    return c.json({
      sessionId,
      startDate: query.startDate,
      endDate: query.endDate,
      routines
    });
  });

  app.post("/sessions/:sessionId/routines/reset", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const resetCount = await dependencies.routineRepository.resetAll();

    return c.json({
      sessionId,
      resetCount
    });
  });

  app.post("/sessions/:sessionId/recover", async (c) => {
    const body = recoverSessionBodySchema.parse(await c.req.json());
    try {
      const snapshot = await dependencies.sessionManager.recover(
        body.snapshot as SessionSnapshot
      );
      return c.json({ session: snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }
  });
}
