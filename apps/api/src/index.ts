import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";

import {
  createAgentRuntime,
  createDefaultToolRegistry,
  createFileSessionManager,
  createMiniMaxRuntime,
  createPromptBuilder,
  createFileTraceManager,
  resolveToolChoice,
  resolveSessionStateDirectory,
  type SessionSnapshot
} from "@ai-app-template/agent";

import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stateDirectory = resolveSessionStateDirectory(workspaceRoot);
const sessionManager = createFileSessionManager(stateDirectory);
const traceManager = createFileTraceManager(stateDirectory);
const promptBuilder = createPromptBuilder();
const miniMaxRuntime = createMiniMaxRuntime(process.env);
const toolChoice = resolveToolChoice(process.env);

const app = new Hono();

const createSessionBodySchema = z.object({
  workingDirectory: z.string().optional()
});

const executeSessionBodySchema = z.object({
  message: z.string().min(1)
});

const recoverSessionBodySchema = z.object({
  snapshot: z.unknown()
});

function buildWorkingDirectory(input?: string): string {
  return input ? path.resolve(workspaceRoot, input) : workspaceRoot;
}

function createRuntime(session: SessionSnapshot) {
  if (!miniMaxRuntime) {
    throw new Error("MiniMax runtime is not configured.");
  }

  return createAgentRuntime({
    client: miniMaxRuntime.client,
    model: session.model,
    sessionManager,
    toolRegistry: createDefaultToolRegistry({
      workingDirectory: session.workingDirectory
    }),
    traceManager,
    promptBuilder,
    maxTurns: 6,
    maxTokens: 512,
    ...(toolChoice ? { toolChoice } : {})
  });
}

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
  const sessions = await sessionManager.listSessions();
  return c.json({ sessions });
});

app.post("/sessions", async (c) => {
  const body = createSessionBodySchema.parse(await c.req.json());
  const createInput: {
    workingDirectory: string;
    model?: string;
  } = {
    workingDirectory: buildWorkingDirectory(body.workingDirectory)
  };

  if (miniMaxRuntime) {
    createInput.model = miniMaxRuntime.model;
  }

  const session = await sessionManager.createSession(createInput);

  return c.json({ session }, 201);
});

app.get("/sessions/:sessionId", async (c) => {
  const session = await sessionManager.getSession(c.req.param("sessionId"));
  if (!session) {
    return c.json({ error: "Session not found." }, 404);
  }

  return c.json({ session });
});

app.post("/sessions/:sessionId/execute", async (c) => {
  if (!miniMaxRuntime) {
    return c.json(
      {
        error:
          "MiniMax runtime is not configured. Set API_KEY or MINIMAX_API_KEY and ANTHROPIC_BASE_URL."
      },
      503
    );
  }

  const body = executeSessionBodySchema.parse(await c.req.json());
  const sessionId = c.req.param("sessionId");
  const currentSession = await sessionManager.getSession(sessionId);

  if (!currentSession) {
    return c.json({ error: "Session not found." }, 404);
  }

  const runtime = createRuntime(currentSession);
  const result = await runtime.run({
    sessionId,
    message: body.message
  });

  return c.json(result);
});

app.post("/sessions/:sessionId/snapshot", async (c) => {
  const session = await sessionManager.getSession(c.req.param("sessionId"));
  if (!session) {
    return c.json({ error: "Session not found." }, 404);
  }

  return c.json({ snapshot: session });
});

app.get("/sessions/:sessionId/trace", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    return c.json({ error: "Session not found." }, 404);
  }

  const events = await traceManager.readEvents(sessionId);
  return c.json({ sessionId, events });
});

app.post("/sessions/:sessionId/recover", async (c) => {
  const body = recoverSessionBodySchema.parse(await c.req.json());
  try {
    const snapshot = await sessionManager.recover(
      body.snapshot as SessionSnapshot
    );
    return c.json({ session: snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  }
);
