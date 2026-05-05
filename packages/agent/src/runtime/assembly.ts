import type {
  BackgroundTaskRepository,
  CronJobRepository,
  InboxBindingRepository,
  RoutineRepository
} from "@ai-app-template/db";
import {
  createPostgresBackgroundTaskRepository,
  createPostgresDatabase,
  createPostgresCronJobRepository,
  createPostgresInboxBindingRepository,
  createPostgresRoutineRepository,
  ensureProductSchema,
  resolveDatabaseUrl
} from "@ai-app-template/db";

import { DEFAULT_SESSION_MAX_TURNS } from "@ai-app-template/domain";

import type { DelegateAgentService } from "../delegation/index.js";
import {
  createBackgroundTaskManager,
  type BackgroundTaskManager
} from "../background-tasks/index.js";
import {
  createCronJobDispatcher,
  type CronJobDispatcher
} from "../cron/dispatcher.js";
import { createLspServerManager } from "../lsp/index.js";
import {
  resolveMaxTokens,
  resolveToolChoice,
  type AnthropicToolChoice
} from "../model.js";
import { createModelService, type ModelService } from "../models/index.js";
import { loadWorkspaceMcpTools } from "../mcp/index.js";
import { createPromptBuilder, type PromptBuilder } from "../prompt.js";
import { createAgentRuntime, type AgentRuntime } from "../runtime.js";
import {
  createPostgresSessionManager,
  resolveSessionStateDirectory,
  type SessionManager
} from "../session.js";
import {
  createFileSystemLogManager,
  createLogger,
  type Logger,
  type SystemLogManager
} from "../system-log.js";
import {
  createDefaultToolRegistry,
  listSettingsPermissionToolOptions
} from "../tools/index.js";
import {
  createSettingsConfigStore,
  type SettingsConfigStore
} from "../settings-config/index.js";
import { createFileTraceManager, type TraceManager } from "../trace.js";
import type { TraceEvent, TraceMcpLoadedEvent } from "../trace.js";
import type { SessionSnapshot } from "../types.js";

export interface PostgresRuntimeEnvironment {
  workspaceRoot: string;
  stateDirectory: string;
  traceManager: TraceManager;
  systemLogManager: SystemLogManager;
  runtimeLogger: Logger;
  promptBuilder: PromptBuilder;
  modelService: ModelService;
  env: NodeJS.ProcessEnv;
  maxTokens: number;
  toolChoice: AnthropicToolChoice | undefined;
  routineRepository: RoutineRepository;
  sessionManager: SessionManager;
  cronJobRepository: CronJobRepository;
  cronJobDispatcher: CronJobDispatcher;
  backgroundTaskRepository: BackgroundTaskRepository;
  backgroundTaskManager: BackgroundTaskManager;
  settingsConfigStore: SettingsConfigStore;
  inboxBindingRepository: InboxBindingRepository;
}

export interface CreatePostgresRuntimeEnvironmentInput {
  workspaceRoot: string;
  settingsPermissionWorkingDirectory: string;
  env?: NodeJS.ProcessEnv;
  databaseUrlRequiredMessage?: string;
}

export interface RuntimeHandle {
  runtime: AgentRuntime;
  dispose(): Promise<void>;
  preRunTraceEvent?: TraceEvent;
}

export function createRuntimeHandleFactory(input: {
  environment: PostgresRuntimeEnvironment;
  delegateAgentService?: DelegateAgentService;
}): (session: SessionSnapshot) => Promise<RuntimeHandle> {
  const { environment, delegateAgentService } = input;

  return async (session) => {
    const settings = await environment.settingsConfigStore.getEffectiveSettings(
      session.workingDirectory
    );
    const lspServerManager = createLspServerManager({
      workingDirectory: session.workingDirectory
    });
    let mcpLoadResult: Awaited<
      ReturnType<typeof loadWorkspaceMcpTools>
    > | null = null;

    try {
      const toolRegistry = createDefaultToolRegistry({
        workingDirectory: session.workingDirectory,
        lspServerManager,
        enabledCapabilityPacks: session.context.enabledCapabilityPacks,
        workspaceSkillSettings: settings.workspaceSkillSettings,
        env: environment.env,
        telegramChatTool: {
          inboxBindingRepository: environment.inboxBindingRepository,
          env: environment.env
        }
      });
      mcpLoadResult = await loadWorkspaceMcpTools(session.workingDirectory);
      for (const tool of mcpLoadResult.tools) {
        toolRegistry.register(tool);
      }
      const loadResult = mcpLoadResult;

      return {
        runtime: createAgentRuntime({
          modelService: environment.modelService,
          sessionManager: environment.sessionManager,
          routineRepository: environment.routineRepository,
          cronJobRepository: environment.cronJobRepository,
          toolRegistry,
          backgroundTaskManager: environment.backgroundTaskManager,
          traceManager: environment.traceManager,
          systemLogManager: environment.systemLogManager,
          runtimeLogger: environment.runtimeLogger,
          promptBuilder: environment.promptBuilder,
          userContextHooks: settings.userContextHooks,
          workspaceSkillSettings: settings.workspaceSkillSettings,
          userCustomPrompt: settings.userCustomPrompt,
          maxTurns: DEFAULT_SESSION_MAX_TURNS,
          maxTokens: environment.maxTokens,
          ...(environment.toolChoice
            ? { toolChoice: environment.toolChoice }
            : {}),
          ...(delegateAgentService ? { delegateAgentService } : {})
        }),
        async dispose() {
          await Promise.all([loadResult.dispose(), lspServerManager.dispose()]);
        },
        preRunTraceEvent: buildMcpLoadedTraceEvent(session, loadResult)
      };
    } catch (error) {
      await Promise.allSettled([
        lspServerManager.dispose(),
        mcpLoadResult?.dispose()
      ]);
      throw error;
    }
  };
}

export async function createPostgresRuntimeEnvironment(
  input: CreatePostgresRuntimeEnvironmentInput
): Promise<PostgresRuntimeEnvironment> {
  const env = input.env ?? process.env;
  const stateDirectory = resolveSessionStateDirectory(input.workspaceRoot);
  const traceManager = createFileTraceManager(stateDirectory);
  const systemLogManager = createFileSystemLogManager(stateDirectory, env);
  const modelService = createModelService(env);
  const databaseUrl = resolveDatabaseUrl(env);

  if (!databaseUrl) {
    throw new Error(
      input.databaseUrlRequiredMessage ??
        "DATABASE_URL is required for the current runtime assembly."
    );
  }

  const database = createPostgresDatabase(databaseUrl);
  await ensureProductSchema(database);

  const routineRepository = createPostgresRoutineRepository(database);
  const sessionManager = createPostgresSessionManager(database);
  const cronJobRepository = createPostgresCronJobRepository(database);
  const backgroundTaskRepository =
    createPostgresBackgroundTaskRepository(database);
  const inboxBindingRepository = createPostgresInboxBindingRepository(database);
  const backgroundTaskManager = createBackgroundTaskManager({
    sessionManager,
    repository: backgroundTaskRepository
  });
  const settingsPermissionToolOptions = listSettingsPermissionToolOptions({
    workingDirectory: input.settingsPermissionWorkingDirectory
  }).map((tool) => tool.name);
  const settingsConfigStore = createSettingsConfigStore({
    db: database,
    seedUserId: "cli-user",
    settingsPermissionToolOptions
  });
  const cronJobDispatcher = createCronJobDispatcher({
    db: database,
    modelService,
    settingsConfigStore
  });

  return {
    workspaceRoot: input.workspaceRoot,
    stateDirectory,
    traceManager,
    systemLogManager,
    runtimeLogger: createLogger({
      manager: systemLogManager,
      component: "runtime"
    }),
    promptBuilder: createPromptBuilder(),
    modelService,
    env,
    maxTokens: resolveMaxTokens(env),
    toolChoice: resolveToolChoice(env),
    routineRepository,
    sessionManager,
    cronJobRepository,
    cronJobDispatcher,
    backgroundTaskRepository,
    backgroundTaskManager,
    settingsConfigStore,
    inboxBindingRepository
  };
}

function buildMcpLoadedTraceEvent(
  session: SessionSnapshot,
  loadResult: Awaited<ReturnType<typeof loadWorkspaceMcpTools>>
): TraceMcpLoadedEvent {
  return {
    kind: "mcp_loaded",
    turnCount: Math.max(1, session.sessionState.turnCount + 1),
    configPath: loadResult.configPath,
    foundConfig: loadResult.foundConfig,
    diagnostics: loadResult.diagnostics,
    servers: loadResult.servers
  };
}
