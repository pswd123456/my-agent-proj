import { serve } from "@hono/node-server";

import {
  createAgentRuntime,
  createDefaultToolRegistry,
  createPostgresSessionManager,
  createMiniMaxRuntime,
  createPromptBuilder,
  createFileTraceManager,
  resolveToolChoice,
  resolveSessionStateDirectory,
  type SessionSnapshot
} from "@ai-app-template/agent";
import {
  createPostgresDatabase,
  createPostgresRoutineRepository,
  ensureProductSchema,
  resolveDatabaseUrl
} from "@ai-app-template/db";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApiApp } from "./app.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stateDirectory = resolveSessionStateDirectory(workspaceRoot);
const traceManager = createFileTraceManager(stateDirectory);
const promptBuilder = createPromptBuilder();
const miniMaxRuntime = createMiniMaxRuntime(process.env);
const toolChoice = resolveToolChoice(process.env);
const databaseUrl = resolveDatabaseUrl(process.env);

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for product1.");
}

const database = createPostgresDatabase(databaseUrl);
await ensureProductSchema(database);
const routineRepository = createPostgresRoutineRepository(database);
const sessionManager = createPostgresSessionManager(database);

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
    routineRepository,
    toolRegistry: createDefaultToolRegistry({ routineRepository }),
    traceManager,
    promptBuilder,
    maxTurns: 6,
    ...(toolChoice ? { toolChoice } : {})
  });
}

export const app = createApiApp({
  sessionManager,
  routineRepository,
  traceManager,
  buildWorkingDirectory,
  ...(miniMaxRuntime ? { runtimeFactory: createRuntime } : {}),
  ...(miniMaxRuntime ? { defaultModel: miniMaxRuntime.model } : {}),
  runtimeUnavailableMessage:
    "MiniMax runtime is not configured. Set API_KEY or MINIMAX_API_KEY and ANTHROPIC_BASE_URL."
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);

if (import.meta.main) {
  serve(
    {
      fetch: app.fetch,
      port
    },
    (info) => {
      console.log(`API listening on http://localhost:${info.port}`);
    }
  );
}
