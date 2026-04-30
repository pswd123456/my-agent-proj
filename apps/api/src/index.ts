import { serve } from "@hono/node-server";

import {
  createAgentRuntime,
  createBackgroundTaskManager,
  createDelegateAgentService,
  createDefaultToolRegistry,
  createModelService,
  createPostgresSessionManager,
  createPromptBuilder,
  createFileTraceManager,
  createFileSystemLogManager,
  createLogger,
  createLspServerManager,
  listSettingsPermissionToolOptions,
  loadWorkspaceMcpTools,
  resolveMaxTokens,
  resolveToolChoice,
  resolveSessionStateDirectory,
  type SessionSnapshot
} from "@ai-app-template/agent";
import {
  createPostgresBackgroundTaskRepository,
  createPostgresDatabase,
  createPostgresSettingsRepository,
  createPostgresRoutineRepository,
  ensureProductSchema,
  resolveDatabaseUrl
} from "@ai-app-template/db";

import { fileURLToPath } from "node:url";

import { createApiApp } from "./app.js";
import { pickDirectoryWithSystemDialog } from "./directory-picker.js";
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
const modelService = createModelService(process.env);
const defaultModel = modelService.getDefaultModel();
const maxTokens = resolveMaxTokens(process.env);
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
const sessionManager = createPostgresSessionManager(database);
const backgroundTaskRepository = createPostgresBackgroundTaskRepository(database);
const backgroundTaskManager = createBackgroundTaskManager({
  sessionManager,
  repository: backgroundTaskRepository
});
const delegateAgentService = createDelegateAgentService({
  sessionManager,
  taskManager: backgroundTaskManager
});

function buildWorkingDirectory(input?: string): string {
  return resolveApiWorkingDirectory(workspaceRoot, input);
}

const settingsPermissionToolOptions = listSettingsPermissionToolOptions({
  workingDirectory: buildWorkingDirectory(),
  routineRepository
}).map((tool) => tool.name);
const settingsRepository = createPostgresSettingsRepository(database, {
  settingsPermissionToolOptions
});

async function createRuntime(session: SessionSnapshot) {
  if (!modelService.getDefaultModel()) {
    throw new Error("No configured model provider is available.");
  }

  const settings = await settingsRepository.getOrCreate(session.context.userId);
  const lspServerManager = createLspServerManager({
    workingDirectory: session.workingDirectory
  });
  const toolRegistry = createDefaultToolRegistry({
    workingDirectory: session.workingDirectory,
    routineRepository,
    lspServerManager,
    enabledCapabilityPacks: session.context.enabledCapabilityPacks,
    env: process.env
  });
  const mcpLoadResult = await loadWorkspaceMcpTools(session.workingDirectory);
  for (const tool of mcpLoadResult.tools) {
    toolRegistry.register(tool);
  }

  return {
    runtime: createAgentRuntime({
      modelService,
      sessionManager,
      routineRepository,
      toolRegistry,
      delegateAgentService,
      backgroundTaskManager,
      traceManager,
      systemLogManager,
      runtimeLogger: createLogger({
        manager: systemLogManager,
        component: "runtime"
      }),
      promptBuilder,
      userContextHooks: settings.userContextHooks,
      maxTurns: 50,
      maxTokens,
      ...(toolChoice ? { toolChoice } : {})
    }),
    async dispose() {
      await Promise.all([mcpLoadResult.dispose(), lspServerManager.dispose()]);
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
  backgroundTaskRepository,
  traceManager,
  systemLogManager,
  apiLogger,
  buildWorkingDirectory,
  pickDirectory: pickDirectoryWithSystemDialog,
  modelService,
  ...(defaultModel ? { runtimeFactory: createRuntime } : {}),
  ...(defaultModel ? { defaultModel } : {}),
  runtimeUnavailableMessage:
    "No model provider is configured. Set MINIMAX_API_KEY or DEEPSEEK_API_KEY."
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
