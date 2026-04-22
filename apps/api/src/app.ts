import { Hono } from "hono";
import { z } from "zod";

import type {
  AgentRuntime,
  SessionManager,
  SessionSnapshot,
  TraceManager
} from "@ai-app-template/agent";
import type { RoutineRepository } from "@ai-app-template/db";

const createSessionBodySchema = z.object({
  workingDirectory: z.string().optional(),
  userId: z.string().optional(),
  yoloMode: z.boolean().optional()
});

const updateSessionSettingsBodySchema = z.object({
  yoloMode: z.boolean()
});

const executeSessionBodySchema = z.object({
  message: z.string().min(1),
  maxTurns: z.number().int().min(1).max(20).optional()
});

const recoverSessionBodySchema = z.object({
  snapshot: z.unknown()
});

const listRoutinesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export interface ApiAppDependencies {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  traceManager: TraceManager;
  buildWorkingDirectory(input?: string): string;
  runtimeFactory?: (session: SessionSnapshot) => AgentRuntime;
  defaultModel?: string;
  runtimeUnavailableMessage?: string;
}

function encodeSseEvent<T extends { kind: string }>(event: T): Uint8Array {
  const payload = JSON.stringify(event);
  return new TextEncoder().encode(`event: ${event.kind}\ndata: ${payload}\n\n`);
}

export function createApiApp(dependencies: ApiAppDependencies) {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      name: "my-agent-proj-api",
      status: "ok"
    });
  });

  app.get("/health", (c) => {
    const health = z.object({
      status: z.literal("ok"),
      service: z.literal("api")
    });

    return c.json(
      health.parse({
        status: "ok",
        service: "api"
      })
    );
  });

  app.get("/sessions", async (c) => {
    const sessions = await dependencies.sessionManager.listSessions();
    return c.json({ sessions });
  });

  app.post("/sessions", async (c) => {
    const body = createSessionBodySchema.parse(await c.req.json());
    const createInput: {
      workingDirectory: string;
      model?: string;
      userId?: string;
      yoloMode?: boolean;
    } = {
      workingDirectory: dependencies.buildWorkingDirectory(
        body.workingDirectory
      )
    };

    if (dependencies.defaultModel) {
      createInput.model = dependencies.defaultModel;
    }
    if (body.userId) {
      createInput.userId = body.userId;
    }
    if (typeof body.yoloMode === "boolean") {
      createInput.yoloMode = body.yoloMode;
    }

    const session =
      await dependencies.sessionManager.createSession(createInput);
    return c.json({ session }, 201);
  });

  app.get("/sessions/:sessionId", async (c) => {
    const session = await dependencies.sessionManager.getSession(
      c.req.param("sessionId")
    );
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json({ session });
  });

  app.patch("/sessions/:sessionId/settings", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = updateSessionSettingsBodySchema.parse(await c.req.json());
    const updated = await dependencies.sessionManager.updateContext(sessionId, {
      yoloMode: body.yoloMode
    });
    return c.json({ session: updated });
  });

  app.delete("/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const isExecutionActive =
      await dependencies.sessionManager.isExecutionActive(sessionId);
    if (isExecutionActive) {
      return c.json(
        {
          error:
            "Session is currently running. Wait for the active run to finish before deleting it."
        },
        409
      );
    }

    const deleted = await dependencies.sessionManager.deleteSession(sessionId);
    if (!deleted) {
      return c.json({ error: "Session not found." }, 404);
    }

    await dependencies.traceManager.deleteEvents(sessionId);
    return c.body(null, 204);
  });

  app.post("/sessions/:sessionId/execute", async (c) => {
    if (!dependencies.runtimeFactory) {
      return c.json(
        {
          error:
            dependencies.runtimeUnavailableMessage ??
            "Runtime is not configured."
        },
        503
      );
    }

    const body = executeSessionBodySchema.parse(await c.req.json());
    const sessionId = c.req.param("sessionId");
    const currentSession =
      await dependencies.sessionManager.getSession(sessionId);

    if (!currentSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const runtime = dependencies.runtimeFactory(currentSession);
    try {
      const result = await runtime.run({
        sessionId,
        message: body.message,
        ...(typeof body.maxTurns === "number"
          ? { maxTurns: body.maxTurns }
          : {})
      });

      return c.json(result);
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "SessionExecutionInProgressError"
      ) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  app.post("/sessions/:sessionId/execute/stream", async (c) => {
    if (!dependencies.runtimeFactory) {
      return c.json(
        {
          error:
            dependencies.runtimeUnavailableMessage ??
            "Runtime is not configured."
        },
        503
      );
    }

    const body = executeSessionBodySchema.parse(await c.req.json());
    const sessionId = c.req.param("sessionId");
    const currentSession =
      await dependencies.sessionManager.getSession(sessionId);

    if (!currentSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const runtime = dependencies.runtimeFactory(currentSession);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": stream-start\n\n"));

        void (async () => {
          try {
            await runtime.run({
              sessionId,
              message: body.message,
              ...(typeof body.maxTurns === "number"
                ? { maxTurns: body.maxTurns }
                : {}),
              eventSink(event) {
                controller.enqueue(encodeSseEvent(event));
              }
            });
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === "SessionExecutionInProgressError"
            ) {
              controller.enqueue(
                encodeSseEvent({
                  kind: "run_error",
                  sessionId,
                  createdAt: new Date().toISOString(),
                  error: error.message,
                  status: "failed",
                  stopReason: "session_busy",
                  toolCallCount: 0,
                  toolResultCount: 0,
                  toolOutputs: [],
                  session: null
                })
              );
            }
          } finally {
            controller.close();
          }
        })();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  });

  app.post("/sessions/:sessionId/snapshot", async (c) => {
    const session = await dependencies.sessionManager.getSession(
      c.req.param("sessionId")
    );
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json({ snapshot: session });
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
      session.context.userId,
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

    const resetCount = await dependencies.routineRepository.resetAll(
      session.context.userId
    );

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

  return app;
}
