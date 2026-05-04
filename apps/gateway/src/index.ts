import { fileURLToPath } from "node:url";

import {
  createFileSystemLogManager,
  createLogger,
  createSettingsConfigStore,
  createTelegramClient,
  loadWorkspaceChannelConfig,
  startTelegramPolling,
  type TelegramUpdate
} from "@ai-app-template/agent";
import {
  createPostgresDatabase,
  ensureProductSchema,
  resolveDatabaseUrl
} from "@ai-app-template/db";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const apiBaseUrl = (
  process.env.GATEWAY_API_BASE_URL ??
  process.env.API_BASE_URL ??
  `http://localhost:${process.env.API_PORT ?? 3001}`
).replace(/\/+$/, "");
const databaseUrl = resolveDatabaseUrl(process.env);

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the gateway.");
}

const database = createPostgresDatabase(databaseUrl);
await ensureProductSchema(database);

const systemLogManager = createFileSystemLogManager(workspaceRoot, process.env);
const gatewayLogger = createLogger({
  manager: systemLogManager,
  component: "gateway"
});
const settingsConfigStore = createSettingsConfigStore({
  db: database,
  seedUserId: "cli-user"
});

function createTelegramGatewayFetch(): typeof fetch | undefined {
  if (process.env.GATEWAY_TELEGRAM_DEBUG !== "true") {
    return undefined;
  }

  return async (url, init) => {
    const method = new URL(String(url)).pathname.split("/").pop() ?? "unknown";
    const startedAt = Date.now();
    console.log(`Telegram API request starting: ${method}`);
    try {
      const response = await globalThis.fetch(url, init);
      console.log(
        `Telegram API request completed: ${method} ${response.status} in ${
          Date.now() - startedAt
        }ms`
      );
      return response;
    } catch (error) {
      console.error(
        `Telegram API request failed: ${method} in ${Date.now() - startedAt}ms: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  };
}

async function resolveTelegramGatewayConfig(): Promise<{
  enabled: boolean;
  mode: "polling" | "webhook";
  botToken: string | null;
  webhookSecret: string | null;
}> {
  const settings = await settingsConfigStore.getGlobalSettings();
  const config = await loadWorkspaceChannelConfig(settings.workingDirectory);
  for (const diagnostic of config.diagnostics) {
    await gatewayLogger.warn("gateway_channel_config_diagnostic", {
      channel: diagnostic.channelName ?? null,
      code: diagnostic.code,
      message: diagnostic.message
    });
  }

  const envBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const envWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  if (!config.telegram.configuredInFile) {
    return {
      enabled: Boolean(envBotToken),
      mode: "polling",
      botToken: envBotToken,
      webhookSecret: envWebhookSecret
    };
  }

  const botToken = config.telegram.botToken || envBotToken;
  return {
    enabled: config.telegram.enabled,
    mode: config.telegram.mode,
    botToken: config.telegram.enabled && botToken ? botToken : null,
    webhookSecret:
      config.telegram.enabled && config.telegram.webhookSecret
        ? config.telegram.webhookSecret
        : envWebhookSecret
  };
}

async function forwardTelegramUpdate(
  update: TelegramUpdate,
  webhookSecret: string | null
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (webhookSecret) {
    headers.set("x-telegram-bot-api-secret-token", webhookSecret);
  }

  const response = await fetch(`${apiBaseUrl}/inbox/telegram/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify(update)
  });
  if (!response.ok) {
    throw new Error(
      `Telegram update ${update.update_id} failed with HTTP ${
        response.status
      }: ${await response.text()}`
    );
  }
}

const telegramConfig = await resolveTelegramGatewayConfig();

await gatewayLogger.info("gateway_ready", {
  apiBaseUrl,
  telegramEnabled: telegramConfig.enabled,
  telegramMode: telegramConfig.mode
});
console.log(`Gateway ready. API target: ${apiBaseUrl}`);

let telegramPolling:
  | ReturnType<typeof startTelegramPolling>
  | null = null;

if (!telegramConfig.enabled || !telegramConfig.botToken) {
  console.log("Telegram channel is disabled or missing a bot token.");
} else if (telegramConfig.mode !== "polling") {
  console.log("Telegram channel is configured for webhook mode; polling skipped.");
} else {
  const requestTimeoutMs = Number(
    process.env.GATEWAY_TELEGRAM_REQUEST_TIMEOUT_MS ?? 12_000
  );
  const pollTimeoutSeconds = Number(
    process.env.GATEWAY_TELEGRAM_POLL_TIMEOUT_SECONDS ?? 5
  );
  const debugFetch = createTelegramGatewayFetch();
  const client = createTelegramClient({
    botToken: telegramConfig.botToken,
    requestTimeoutMs,
    ...(debugFetch ? { fetch: debugFetch } : {})
  });
  telegramPolling = startTelegramPolling({
    client,
    log: (message: string) => console.log(message),
    error: (message: string) => console.error(message),
    cleanupWebhookOnStart: false,
    pollTimeoutSeconds,
    async onUpdate(update: TelegramUpdate) {
      console.log(`Telegram update received: ${update.update_id}`);
      await forwardTelegramUpdate(update, telegramConfig.webhookSecret);
    }
  });
}

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  telegramPolling?.stop();
  void gatewayLogger.info("gateway_shutdown", { signal });
  void telegramPolling?.done.finally(() => {
    void database.$client.end();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (telegramPolling) {
  await telegramPolling.done;
} else {
  await new Promise<void>((resolve) => {
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
  await database.$client.end();
}
