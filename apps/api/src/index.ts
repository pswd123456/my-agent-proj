import { serve } from "@hono/node-server";

import {
  createAgentRuntime,
  createDefaultToolRegistry,
  createPostgresSessionManager,
  createMiniMaxRuntime,
  createPromptBuilder,
  createFileTraceManager,
  createFileSystemLogManager,
  createLogger,
  loadWorkspaceMcpTools,
  resolveToolChoice,
  resolveSessionStateDirectory,
  type SessionSnapshot
} from "@ai-app-template/agent";
import {
  createPostgresDatabase,
  createPostgresSettingsRepository,
  createPostgresRoutineRepository,
  ensureProductSchema,
  resolveDatabaseUrl
} from "@ai-app-template/db";

import { fileURLToPath } from "node:url";

import { createApiApp } from "./app.js";
import {
  ensureApiWorkingDirectory,
  resolveApiWorkingDirectory
} from "./working-directory.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stateDirectory = resolveSessionStateDirectory(workspaceRoot);
const traceManager = createFileTraceManager(stateDirectory);
const systemLogManager = createFileSystemLogManager(stateDirectory, process.env);
const apiLogger = createLogger({ manager: systemLogManager, component: "api" });
const promptBuilder = createPromptBuilder();
const miniMaxRuntime = createMiniMaxRuntime(process.env);
const toolChoice = resolveToolChoice(process.env);
const databaseUrl = resolveDatabaseUrl(process.env);

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the current API assembly because session and routine persistence use PostgreSQL."
  );
}

const database = createPostgresDatabase(databaseUrl);
await ensureProductSchema(database);
await ensureApiWorkingDirectory(workspaceRoot);
const routineRepository = createPostgresRoutineRepository(database);
const settingsRepository = createPostgresSettingsRepository(database);
const sessionManager = createPostgresSessionManager(database);

function buildWorkingDirectory(input?: string): string {
  return resolveApiWorkingDirectory(workspaceRoot, input);
}

async function createRuntime(session: SessionSnapshot) {
  if (!miniMaxRuntime) {
    throw new Error("MiniMax runtime is not configured.");
  }

  const toolRegistry = createDefaultToolRegistry({
    workingDirectory: session.workingDirectory,
    routineRepository,
    enabledCapabilityPacks: session.context.enabledCapabilityPacks
  });
  const mcpLoadResult = await loadWorkspaceMcpTools(session.workingDirectory);
  for (const tool of mcpLoadResult.tools) {
    toolRegistry.register(tool);
  }

  return {
    runtime: createAgentRuntime({
      client: miniMaxRuntime.client,
      model: session.model,
      sessionManager,
      routineRepository,
      toolRegistry,
      traceManager,
      systemLogManager,
      runtimeLogger: createLogger({
        manager: systemLogManager,
        component: "runtime"
      }),
      promptBuilder,
      maxTurns: 50,
      ...(toolChoice ? { toolChoice } : {})
    }),
    async dispose() {
      await mcpLoadResult.dispose();
    },
    preRunTraceEvent: {
      kind: "mcp_loaded" as const,
      turnCount: Math.max(1, session.sessionState.turnCount + 1),
      configPath: mcpLoadResult.configPath,
      foundConfig: mcpLoadResult.foundConfig,
      diagnostics: mcpLoadResult.diagnostics,
      servers: mcpLoadResult.servers
    }
  };
}

export const app = createApiApp({
  sessionManager,
  routineRepository,
  settingsRepository,
  traceManager,
  systemLogManager,
  apiLogger,
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
