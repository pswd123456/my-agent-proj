import { serve } from "@hono/node-server";

import {
  createDelegateAgentService,
  createLogger
} from "@ai-app-template/agent";
import {
  createPostgresRuntimeEnvironment,
  createRuntimeHandleFactory
} from "@ai-app-template/agent/runtime/assembly";
import { fileURLToPath } from "node:url";

import { createApiApp } from "./app.js";
import { pickDirectoryWithSystemDialog } from "./directory-picker.js";
import {
  ensureApiWorkingDirectory,
  resolveApiWorkingDirectory
} from "./working-directory.js";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

function buildWorkingDirectory(input?: string): string {
  return resolveApiWorkingDirectory(workspaceRoot, input);
}

await ensureApiWorkingDirectory(workspaceRoot);

const runtimeEnvironment = await createPostgresRuntimeEnvironment({
  workspaceRoot,
  env: process.env,
  settingsPermissionWorkingDirectory: buildWorkingDirectory(),
  databaseUrlRequiredMessage:
    "DATABASE_URL is required for the current API assembly because session and routine persistence use PostgreSQL."
});
const apiLogger = createLogger({
  manager: runtimeEnvironment.systemLogManager,
  component: "api"
});
const delegateAgentService = createDelegateAgentService({
  sessionManager: runtimeEnvironment.sessionManager,
  taskManager: runtimeEnvironment.backgroundTaskManager
});
const defaultModel = runtimeEnvironment.modelService.getDefaultModel();
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const runtimeFactory = createRuntimeHandleFactory({
  environment: runtimeEnvironment,
  delegateAgentService
});

export const app = createApiApp({
  sessionManager: runtimeEnvironment.sessionManager,
  routineRepository: runtimeEnvironment.routineRepository,
  cronJobRepository: runtimeEnvironment.cronJobRepository,
  settingsRepository: runtimeEnvironment.settingsRepository,
  inboxBindingRepository: runtimeEnvironment.inboxBindingRepository,
  backgroundTaskRepository: runtimeEnvironment.backgroundTaskRepository,
  traceManager: runtimeEnvironment.traceManager,
  systemLogManager: runtimeEnvironment.systemLogManager,
  apiLogger,
  buildWorkingDirectory,
  pickDirectory: pickDirectoryWithSystemDialog,
  modelService: runtimeEnvironment.modelService,
  ...(defaultModel ? { runtimeFactory } : {}),
  ...(defaultModel ? { defaultModel } : {}),
  ...(telegramBotToken ? { telegramBotToken } : {}),
  ...(telegramWebhookSecret ? { telegramWebhookSecret } : {}),
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
