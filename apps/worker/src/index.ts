import { fileURLToPath } from "node:url";

import {
  createAgentRuntime,
  createBackgroundTaskManager,
  createDefaultToolRegistry,
  enqueueBackgroundNotification,
  createFileSystemLogManager,
  createFileTraceManager,
  createLogger,
  createLspServerManager,
  createModelService,
  createPostgresSessionManager,
  createPromptBuilder,
  loadWorkspaceMcpTools,
  resolveMaxTokens,
  resolveSessionStateDirectory,
  resolveToolChoice,
  runBackgroundTask,
  type BackgroundTaskRuntimeHandle,
  type SessionSnapshot
} from "@ai-app-template/agent";
import {
  createPostgresBackgroundTaskRepository,
  createPostgresDatabase,
  createPostgresRoutineRepository,
  ensureProductSchema,
  resolveDatabaseUrl
} from "@ai-app-template/db";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stateDirectory = resolveSessionStateDirectory(workspaceRoot);
const traceManager = createFileTraceManager(stateDirectory);
const systemLogManager = createFileSystemLogManager(stateDirectory, process.env);
const workerLogger = createLogger({
  manager: systemLogManager,
  component: "worker"
});
const promptBuilder = createPromptBuilder();
const modelService = createModelService(process.env);
const maxTokens = resolveMaxTokens(process.env);
const toolChoice = resolveToolChoice(process.env);
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000);
const heartbeatIntervalMs = Number(
  process.env.WORKER_TASK_HEARTBEAT_MS ?? 1_000
);
const staleTaskMs = Number(process.env.WORKER_TASK_STALE_MS ?? 30_000);
const workerId = process.env.WORKER_ID?.trim() || `worker-${process.pid}`;

const databaseUrl = resolveDatabaseUrl(process.env);
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the background worker.");
}

const database = createPostgresDatabase(databaseUrl);
await ensureProductSchema(database);

const routineRepository = createPostgresRoutineRepository(database);
const sessionManager = createPostgresSessionManager(database);
const backgroundTaskRepository = createPostgresBackgroundTaskRepository(database);
const backgroundTaskManager = createBackgroundTaskManager({
  sessionManager,
  repository: backgroundTaskRepository
});

async function createRuntimeHandle(
  session: SessionSnapshot
): Promise<BackgroundTaskRuntimeHandle> {
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
      backgroundTaskManager,
      traceManager,
      systemLogManager,
      runtimeLogger: createLogger({
        manager: systemLogManager,
        component: "runtime"
      }),
      promptBuilder,
      maxTurns: 50,
      maxTokens,
      ...(toolChoice ? { toolChoice } : {})
    }),
    async dispose() {
      await Promise.all([mcpLoadResult.dispose(), lspServerManager.dispose()]);
    },
    preRunTraceEvent: {
      kind: "mcp_loaded",
      turnCount: Math.max(1, session.sessionState.turnCount + 1),
      configPath: mcpLoadResult.configPath,
      foundConfig: mcpLoadResult.foundConfig,
      diagnostics: mcpLoadResult.diagnostics,
      servers: mcpLoadResult.servers
    }
  };
}

async function reconcileStaleTasks(): Promise<void> {
  const staleTasks = await backgroundTaskManager.requeueStaleClaims(
    new Date(Date.now() - staleTaskMs).toISOString()
  );

  for (const task of staleTasks) {
    if (task.status !== "failed") {
      continue;
    }

    if (task.kind === "subagent") {
      const delegateState =
        task.taskState?.kind === "delegate" ? task.taskState : null;
      const latestResponse = delegateState?.latestResponse;
      await enqueueBackgroundNotification({
        sessionManager,
        traceManager,
        taskManager: backgroundTaskManager,
        task,
        kind: "task_timeout",
        summary:
          latestResponse?.summary ?? task.resultSummary ?? "后台子任务超时。",
        content:
          latestResponse?.content ??
          task.lastError ??
          "Worker claim expired before completion.",
        expectedParentReply: delegateState?.expectedParentReply ?? "none",
        request: latestResponse?.request ?? null,
        result: latestResponse
          ? {
              type: "delegate",
              summary: latestResponse.summary,
              content: latestResponse.content,
              responseKind: latestResponse.kind,
              expectedParentReply:
                delegateState?.expectedParentReply ?? "none",
              ...(latestResponse.request
                ? { request: latestResponse.request }
                : {})
            }
          : null,
        decrementActiveTaskCount: true
      });
      continue;
    }

    if (task.kind === "shell_command") {
      const latestResult =
        task.taskState?.kind === "shell_command"
          ? task.taskState.latestResult
          : null;
      await enqueueBackgroundNotification({
        sessionManager,
        traceManager,
        taskManager: backgroundTaskManager,
        task,
        kind: "task_timeout",
        summary: task.resultSummary ?? "后台任务超时。",
        content: task.lastError ?? "Worker claim expired before completion.",
        expectedParentReply: "none",
        result: latestResult,
        decrementActiveTaskCount: true
      });
      continue;
    }

    if (task.kind === "session_wakeup") {
      await enqueueBackgroundNotification({
        sessionManager,
        traceManager,
        taskManager: backgroundTaskManager,
        task,
        kind: "task_timeout",
        title: "主会话后台续跑",
        summary: "主会话后台续跑超时。",
        content: task.lastError ?? "Worker claim expired before completion.",
        expectedParentReply: "none",
        autoWake: false
      });
    }
  }
}

async function drainQueuedTasks(): Promise<void> {
  await reconcileStaleTasks();

  while (true) {
    const claim = await backgroundTaskManager.claimNextTask(workerId);
    if (!claim) {
      return;
    }

    await workerLogger.info("background_task_claimed", {
      taskId: claim.task.taskId,
      runId: claim.run.runId,
      kind: claim.task.kind,
      childSessionId: claim.task.childSessionId
    });

    await runBackgroundTask({
      claim,
      workerId,
      heartbeatIntervalMs,
      sessionManager,
      taskManager: backgroundTaskManager,
      traceManager,
      createRuntimeHandle
    });
  }
}

let shuttingDown = false;

async function tick(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  try {
    await drainQueuedTasks();
  } catch (error) {
    await workerLogger.error("background_worker_tick_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

await workerLogger.info("background_worker_ready", {
  workerId,
  pollIntervalMs,
  heartbeatIntervalMs,
  staleTaskMs
});

await tick();
const timer = setInterval(() => {
  void tick();
}, pollIntervalMs);

function shutdown(signal: string): void {
  shuttingDown = true;
  clearInterval(timer);
  void workerLogger.info("background_worker_shutdown", { signal, workerId });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
