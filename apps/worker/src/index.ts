import { fileURLToPath } from "node:url";

import {
  buildStaleBackgroundTaskLifecycleNotification,
  createLogger,
  enqueueBackgroundTaskLifecycleNotification,
  runBackgroundTask
} from "@ai-app-template/agent";
import {
  createPostgresRuntimeEnvironment,
  createRuntimeHandleFactory
} from "@ai-app-template/agent/runtime/assembly";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runtimeEnvironment = await createPostgresRuntimeEnvironment({
  workspaceRoot,
  env: process.env,
  settingsPermissionWorkingDirectory: workspaceRoot,
  databaseUrlRequiredMessage:
    "DATABASE_URL is required for the background worker."
});
const workerLogger = createLogger({
  manager: runtimeEnvironment.systemLogManager,
  component: "worker"
});
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000);
const heartbeatIntervalMs = Number(
  process.env.WORKER_TASK_HEARTBEAT_MS ?? 1_000
);
const staleTaskMs = Number(process.env.WORKER_TASK_STALE_MS ?? 30_000);
const workerId = process.env.WORKER_ID?.trim() || `worker-${process.pid}`;
const createRuntimeHandle = createRuntimeHandleFactory({
  environment: runtimeEnvironment
});

async function reconcileStaleTasks(): Promise<void> {
  const staleTasks =
    await runtimeEnvironment.backgroundTaskManager.requeueStaleClaims(
      new Date(Date.now() - staleTaskMs).toISOString()
    );

  for (const task of staleTasks) {
    if (task.status !== "failed") {
      continue;
    }

    const notification = buildStaleBackgroundTaskLifecycleNotification(task);
    await enqueueBackgroundTaskLifecycleNotification({
      sessionManager: runtimeEnvironment.sessionManager,
      traceManager: runtimeEnvironment.traceManager,
      taskManager: runtimeEnvironment.backgroundTaskManager,
      task,
      kind: notification.kind,
      fallbackSummary: notification.fallbackSummary,
      fallbackContent: notification.fallbackContent,
      decrementActiveTaskCount: notification.decrementActiveTaskCount,
      ...(typeof notification.autoWake === "boolean"
        ? { autoWake: notification.autoWake }
        : {})
    });
  }
}

async function drainDueCronJobs(): Promise<void> {
  const excludedCronJobIds = new Set<string>();

  while (true) {
    const result =
      await runtimeEnvironment.cronJobDispatcher.dispatchNextDueCronJob({
        excludeCronJobIds: [...excludedCronJobIds]
      });
    if (!result) {
      return;
    }

    if (result.outcome === "failed") {
      excludedCronJobIds.add(result.cronJobId);
      await workerLogger.error("cron_job_dispatch_failed", {
        cronJobId: result.cronJobId,
        error: result.error
      });
      continue;
    }

    await workerLogger.info("cron_job_dispatched", {
      cronJobId: result.cronJobId,
      sessionId: result.sessionId,
      taskId: result.taskId
    });
  }
}

async function drainQueuedTasks(): Promise<void> {
  await drainDueCronJobs();
  await reconcileStaleTasks();

  while (true) {
    const claim =
      await runtimeEnvironment.backgroundTaskManager.claimNextTask(workerId);
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
      sessionManager: runtimeEnvironment.sessionManager,
      taskManager: runtimeEnvironment.backgroundTaskManager,
      traceManager: runtimeEnvironment.traceManager,
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
