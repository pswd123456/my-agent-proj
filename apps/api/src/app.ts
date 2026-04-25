import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type {
  AgentRuntime,
  JsonValue,
  Logger,
  SessionManager,
  SessionSnapshot,
  SystemLogManager,
  TraceManager
} from "@ai-app-template/agent";
import {
  DEFAULT_SESSION_SETTINGS_USER_ID,
  SESSION_MAX_TURNS_LIMIT,
  normalizeCapabilityPacks,
  normalizePermissionRuleLists,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns
} from "@ai-app-template/domain";
import type { SessionSettingsRecord } from "@ai-app-template/domain";
import type {
  RoutineRepository,
  SettingsRepository
} from "@ai-app-template/db";

const createSessionBodySchema = z.object({
  workingDirectory: z.string().optional(),
  userId: z.string().optional(),
  yoloMode: z.boolean().optional(),
  contextWindow: z.number().int().min(1000).optional(),
  maxTurns: z.number().int().min(1).optional(),
  enabledCapabilityPacks: z.array(z.string()).optional()
});

const updateSessionSettingsBodySchema = z
  .object({
    yoloMode: z.boolean().optional(),
    shellAllowPatterns: z.array(z.string()).optional(),
    shellDenyPatterns: z.array(z.string()).optional(),
    toolAllowList: z.array(z.string()).optional(),
    toolAskList: z.array(z.string()).optional(),
    toolDenyList: z.array(z.string()).optional(),
    enabledCapabilityPacks: z.array(z.string()).optional()
  })
  .refine(
    (value) =>
      typeof value.yoloMode === "boolean" ||
      Array.isArray(value.shellAllowPatterns) ||
      Array.isArray(value.shellDenyPatterns) ||
      Array.isArray(value.toolAllowList) ||
      Array.isArray(value.toolAskList) ||
      Array.isArray(value.toolDenyList) ||
      Array.isArray(value.enabledCapabilityPacks),
    {
      message: "At least one session settings field is required."
    }
  );

const updateUserSettingsBodySchema = z
  .object({
    workingDirectory: z.string().optional(),
    yoloMode: z.boolean().optional(),
    contextWindow: z.number().int().min(1000).optional(),
    maxTurns: z.number().int().min(1).optional(),
    shellAllowPatterns: z.array(z.string()).optional(),
    shellDenyPatterns: z.array(z.string()).optional(),
    toolAllowList: z.array(z.string()).optional(),
    toolAskList: z.array(z.string()).optional(),
    toolDenyList: z.array(z.string()).optional(),
    enabledCapabilityPacks: z.array(z.string()).optional(),
    debugConversationView: z.boolean().optional()
  })
  .refine(
    (value) =>
      typeof value.workingDirectory === "string" ||
      typeof value.yoloMode === "boolean" ||
      typeof value.contextWindow === "number" ||
      typeof value.maxTurns === "number" ||
      Array.isArray(value.shellAllowPatterns) ||
      Array.isArray(value.shellDenyPatterns) ||
      Array.isArray(value.toolAllowList) ||
      Array.isArray(value.toolAskList) ||
      Array.isArray(value.toolDenyList) ||
      Array.isArray(value.enabledCapabilityPacks) ||
      typeof value.debugConversationView === "boolean",
    {
      message: "At least one settings field is required."
    }
  );

const executeSessionBodySchema = z.object({
  message: z.string().min(1),
  maxTurns: z.number().int().min(1).max(SESSION_MAX_TURNS_LIMIT).optional(),
  permissionReply: z.boolean().optional()
});

const recoverSessionBodySchema = z.object({
  snapshot: z.unknown()
});

const listRoutinesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const systemLogsQuerySchema = z.object({
  sessionId: z.string().optional(),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  component: z
    .enum([
      "runtime",
      "permission",
      "tool-execution",
      "confirmation",
      "interrupt",
      "api"
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().optional()
});

export interface ApiAppDependencies {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  settingsRepository: SettingsRepository;
  traceManager: TraceManager;
  systemLogManager: SystemLogManager;
  apiLogger?: Logger;
  buildWorkingDirectory(input?: string): string;
  runtimeFactory?: (session: SessionSnapshot) => AgentRuntime;
  defaultModel?: string;
  defaultUserId?: string;
  runtimeUnavailableMessage?: string;
}

function resolveUserId(
  dependencies: ApiAppDependencies,
  userId: string | undefined
): string {
  const candidate = userId?.trim();
  if (candidate) {
    return candidate;
  }

  return dependencies.defaultUserId ?? DEFAULT_SESSION_SETTINGS_USER_ID;
}

function toCreateSessionInput(input: {
  settings: SessionSettingsRecord;
  defaultModel: string | undefined;
  userId: string;
  workingDirectoryOverride: string | undefined;
  yoloModeOverride: boolean | undefined;
  contextWindowOverride: number | undefined;
  maxTurnsOverride: number | undefined;
  enabledCapabilityPacksOverride: string[] | undefined;
  buildWorkingDirectory: ApiAppDependencies["buildWorkingDirectory"];
}): {
  workingDirectory: string;
  model?: string;
  userId: string;
  yoloMode: boolean;
  contextWindow: number;
  maxTurns: number;
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  enabledCapabilityPacks: string[];
} {
  return {
    workingDirectory: input.buildWorkingDirectory(
      input.workingDirectoryOverride ?? input.settings.workingDirectory
    ),
    ...(input.defaultModel ? { model: input.defaultModel } : {}),
    userId: input.userId,
    yoloMode: input.yoloModeOverride ?? input.settings.yoloMode,
    contextWindow: sanitizeContextWindow(
      input.contextWindowOverride ?? input.settings.contextWindow
    ),
    maxTurns: sanitizeSessionMaxTurns(
      input.maxTurnsOverride ?? input.settings.maxTurns
    ),
    shellAllowPatterns: input.settings.shellAllowPatterns,
    shellDenyPatterns: input.settings.shellDenyPatterns,
    toolAllowList: input.settings.toolAllowList,
    toolAskList: input.settings.toolAskList,
    toolDenyList: input.settings.toolDenyList,
    enabledCapabilityPacks:
      input.enabledCapabilityPacksOverride ??
      input.settings.enabledCapabilityPacks
  };
}

function encodeSseEvent<T extends { kind: string }>(event: T): Uint8Array {
  const payload = JSON.stringify(event);
  return new TextEncoder().encode(`event: ${event.kind}\ndata: ${payload}\n\n`);
}

function getRequestId(c: {
  req: { header(name: string): string | undefined };
}): string {
  return c.req.header("x-request-id")?.trim() || randomUUID();
}

async function logApiEvent(input: {
  logger: Logger | undefined;
  requestId: string;
  event: string;
  level?: "debug" | "info" | "warn" | "error";
  sessionId?: string;
  details?: Record<string, unknown>;
}) {
  const logger = input.logger?.child({
    requestId: input.requestId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {})
  });
  if (!logger) {
    return;
  }

  const details = (input.details ?? null) as JsonValue;
  if (input.level === "debug") {
    await logger.debug(input.event, details);
  } else if (input.level === "warn") {
    await logger.warn(input.event, details);
  } else if (input.level === "error") {
    await logger.error(input.event, details);
  } else {
    await logger.info(input.event, details);
  }
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
    const requestId = getRequestId(c);
    const body = createSessionBodySchema.parse(await c.req.json());
    const userId = resolveUserId(dependencies, body.userId);
    const settings = await dependencies.settingsRepository.getOrCreate(userId);
    const createInput = toCreateSessionInput({
      settings,
      defaultModel: dependencies.defaultModel,
      userId,
      workingDirectoryOverride: body.workingDirectory,
      yoloModeOverride: body.yoloMode,
      contextWindowOverride: body.contextWindow,
      maxTurnsOverride: body.maxTurns,
      enabledCapabilityPacksOverride: body.enabledCapabilityPacks,
      buildWorkingDirectory: dependencies.buildWorkingDirectory
    });

    const session =
      await dependencies.sessionManager.createSession(createInput);
    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_created",
      sessionId: session.sessionId,
      details: { userId, workingDirectory: session.workingDirectory }
    });
    return c.json({ session }, 201);
  });

  app.get("/users/:userId/settings", async (c) => {
    const settings = await dependencies.settingsRepository.getOrCreate(
      resolveUserId(dependencies, c.req.param("userId"))
    );
    return c.json({ settings });
  });

  app.patch("/users/:userId/settings", async (c) => {
    const userId = resolveUserId(dependencies, c.req.param("userId"));
    const body = updateUserSettingsBodySchema.parse(await c.req.json());
    const settings = await dependencies.settingsRepository.update(userId, {
      ...(typeof body.workingDirectory === "string"
        ? {
            workingDirectory: dependencies.buildWorkingDirectory(
              body.workingDirectory
            )
          }
        : {}),
      ...(typeof body.yoloMode === "boolean"
        ? { yoloMode: body.yoloMode }
        : {}),
      ...(typeof body.contextWindow === "number"
        ? { contextWindow: body.contextWindow }
        : {}),
      ...(typeof body.maxTurns === "number" ? { maxTurns: body.maxTurns } : {}),
      ...(Array.isArray(body.shellAllowPatterns)
        ? { shellAllowPatterns: body.shellAllowPatterns }
        : {}),
      ...(Array.isArray(body.shellDenyPatterns)
        ? { shellDenyPatterns: body.shellDenyPatterns }
        : {}),
      ...(Array.isArray(body.toolAllowList)
        ? { toolAllowList: body.toolAllowList }
        : {}),
      ...(Array.isArray(body.toolAskList)
        ? { toolAskList: body.toolAskList }
        : {}),
      ...(Array.isArray(body.toolDenyList)
        ? { toolDenyList: body.toolDenyList }
        : {}),
      ...(Array.isArray(body.enabledCapabilityPacks)
        ? { enabledCapabilityPacks: body.enabledCapabilityPacks }
        : {}),
      ...(typeof body.debugConversationView === "boolean"
        ? { debugConversationView: body.debugConversationView }
        : {})
    });
    return c.json({ settings });
  });

  app.get("/sessions/:sessionId", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_interrupt_requested",
      sessionId,
      details: { found: Boolean(session) }
    });
    return c.json({ session });
  });

  app.patch("/sessions/:sessionId/settings", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = updateSessionSettingsBodySchema.parse(await c.req.json());
    const permissionRules = normalizePermissionRuleLists({
      shellAllowPatterns:
        body.shellAllowPatterns ?? session.context.shellAllowPatterns,
      shellDenyPatterns:
        body.shellDenyPatterns ?? session.context.shellDenyPatterns,
      toolAllowList: body.toolAllowList ?? session.context.toolAllowList,
      toolAskList: body.toolAskList ?? session.context.toolAskList,
      toolDenyList: body.toolDenyList ?? session.context.toolDenyList
    });
    const updated = await dependencies.sessionManager.updateContext(sessionId, {
      ...(typeof body.yoloMode === "boolean"
        ? { yoloMode: body.yoloMode }
        : {}),
      shellAllowPatterns: permissionRules.shellAllowPatterns,
      shellDenyPatterns: permissionRules.shellDenyPatterns,
      toolAllowList: permissionRules.toolAllowList,
      toolAskList: permissionRules.toolAskList,
      toolDenyList: permissionRules.toolDenyList,
      ...(Array.isArray(body.enabledCapabilityPacks)
        ? {
            enabledCapabilityPacks: normalizeCapabilityPacks(
              body.enabledCapabilityPacks
            )
          }
        : {})
    });
    return c.json({ session: updated });
  });

  app.delete("/sessions/:sessionId", async (c) => {
    const requestId = getRequestId(c);
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

  app.post("/sessions/:sessionId/interrupt", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session =
      await dependencies.sessionManager.requestInterrupt(sessionId);
    if (!session) {
      return c.json(
        {
          error:
            "Session is not currently running. Only the active run can be interrupted."
        },
        409
      );
    }

    return c.json({
      sessionId,
      accepted: true,
      session
    });
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
          : {}),
        ...(typeof body.permissionReply === "boolean"
          ? { permissionReply: body.permissionReply }
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
              ...(typeof body.permissionReply === "boolean"
                ? { permissionReply: body.permissionReply }
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

  app.get("/system-logs", async (c) => {
    const requestId = getRequestId(c);
    const query = systemLogsQuerySchema.parse(c.req.query());
    const result = await dependencies.systemLogManager.query({
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.component ? { component: query.component } : {}),
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
        returned: result.records.length
      }
    });
    return c.json(result);
  });

  app.get("/sessions/:sessionId/trace", async (c) => {
    const requestId = getRequestId(c);
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
