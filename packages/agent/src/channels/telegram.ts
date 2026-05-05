import { z } from "zod";

const telegramApiResponseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional()
});

const telegramUpdateSchema = z
  .object({
    update_id: z.number().int()
  })
  .passthrough();

const telegramUpdatesSchema = z.array(telegramUpdateSchema);

export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
}

export interface TelegramSendDocumentInput {
  chatId: string;
  file: Blob;
  filename: string;
  caption?: string;
}

export interface TelegramSetWebhookInput {
  url: string;
  secretToken?: string;
  dropPendingUpdates?: boolean;
}

export interface TelegramDeleteWebhookInput {
  dropPendingUpdates?: boolean;
  signal?: AbortSignal;
}

export interface TelegramGetUpdatesInput {
  offset?: number;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface TelegramClient {
  sendMessage(input: TelegramSendMessageInput): Promise<void>;
  sendDocument(input: TelegramSendDocumentInput): Promise<void>;
  setWebhook(input: TelegramSetWebhookInput): Promise<unknown>;
  deleteWebhook(input?: TelegramDeleteWebhookInput): Promise<unknown>;
  getUpdates(input?: TelegramGetUpdatesInput): Promise<TelegramUpdate[]>;
}

export interface CreateTelegramClientInput {
  botToken: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}

const DEFAULT_TELEGRAM_REQUEST_TIMEOUT_MS = 35_000;
const DEFAULT_TELEGRAM_LONG_POLL_EXTRA_TIMEOUT_MS = 10_000;

function buildTelegramApiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

function splitTelegramMessage(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length <= 3900) {
    return [normalized || "(empty)"];
  }

  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += 3900) {
    chunks.push(normalized.slice(index, index + 3900));
  }
  return chunks;
}

async function parseTelegramResponse(response: Response): Promise<unknown> {
  const payload = telegramApiResponseSchema.parse(await response.json());
  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.description ??
        `Telegram API request failed with status ${response.status}.`
    );
  }

  return payload.result;
}

function parseTelegramUpdates(value: unknown): TelegramUpdate[] {
  return telegramUpdatesSchema.parse(value ?? []);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function createTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal
): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(`Telegram request timed out after ${timeoutMs}ms.`)
    );
  }, timeoutMs);
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  };
}

export function createTelegramClient(
  input: CreateTelegramClientInput
): TelegramClient {
  const fetchImpl = input.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const requestTimeoutMs =
    input.requestTimeoutMs ?? DEFAULT_TELEGRAM_REQUEST_TIMEOUT_MS;

  async function request(
    method: string,
    init: RequestInit,
    timeoutMs = requestTimeoutMs
  ): Promise<unknown> {
    const timeoutSignal = createTimeoutSignal(
      timeoutMs,
      init.signal ?? undefined
    );
    try {
      const response = await fetchImpl(
        buildTelegramApiUrl(input.botToken, method),
        {
          ...init,
          signal: timeoutSignal.signal
        }
      );
      return parseTelegramResponse(response);
    } finally {
      timeoutSignal.dispose();
    }
  }

  return {
    async sendMessage(message) {
      for (const chunk of splitTelegramMessage(message.text)) {
        await request("sendMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: message.chatId,
            text: chunk
          })
        });
      }
    },
    async sendDocument(document) {
      const form = new FormData();
      form.set("chat_id", document.chatId);
      form.set("document", document.file, document.filename);
      if (document.caption?.trim()) {
        form.set("caption", document.caption.trim());
      }

      await request("sendDocument", {
        method: "POST",
        body: form
      });
    },
    async setWebhook(webhook) {
      return request("setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhook.url,
          ...(webhook.secretToken ? { secret_token: webhook.secretToken } : {}),
          ...(typeof webhook.dropPendingUpdates === "boolean"
            ? { drop_pending_updates: webhook.dropPendingUpdates }
            : {})
        })
      });
    },
    async deleteWebhook(webhook = {}) {
      return request("deleteWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(webhook.signal ? { signal: webhook.signal } : {}),
        body: JSON.stringify({
          ...(typeof webhook.dropPendingUpdates === "boolean"
            ? { drop_pending_updates: webhook.dropPendingUpdates }
            : {})
        })
      });
    },
    async getUpdates(updateRequest = {}) {
      const timeoutSeconds = updateRequest.timeoutSeconds ?? 25;
      const result = await request(
        "getUpdates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(updateRequest.signal ? { signal: updateRequest.signal } : {}),
          body: JSON.stringify({
            ...(typeof updateRequest.offset === "number"
              ? { offset: updateRequest.offset }
              : {}),
            timeout: timeoutSeconds,
            allowed_updates: ["message"]
          })
        },
        timeoutSeconds * 1_000 + DEFAULT_TELEGRAM_LONG_POLL_EXTRA_TIMEOUT_MS
      );
      return parseTelegramUpdates(result);
    }
  };
}

export interface TelegramPollingHandle {
  stop(): void;
  done: Promise<void>;
}

export interface StartTelegramPollingInput {
  client: TelegramClient;
  onUpdate(update: TelegramUpdate): Promise<void>;
  log?(message: string): void;
  error?(message: string): void;
  signal?: AbortSignal;
  dropPendingUpdates?: boolean;
  cleanupWebhookOnStart?: boolean;
  pollTimeoutSeconds?: number;
  retryDelayMs?: number;
}

export function startTelegramPolling(
  input: StartTelegramPollingInput
): TelegramPollingHandle {
  const controller = new AbortController();
  input.signal?.addEventListener(
    "abort",
    () => {
      controller.abort();
    },
    { once: true }
  );
  const signal = controller.signal;
  const pollTimeoutSeconds = input.pollTimeoutSeconds ?? 25;
  const retryDelayMs = input.retryDelayMs ?? 3_000;
  let offset: number | undefined;

  const done = (async () => {
    input.log?.("Telegram polling starting.");
    if (input.cleanupWebhookOnStart !== false) {
      try {
        await input.client.deleteWebhook({
          ...(typeof input.dropPendingUpdates === "boolean"
            ? { dropPendingUpdates: input.dropPendingUpdates }
            : {}),
          signal
        });
      } catch (error) {
        if (!signal.aborted) {
          input.error?.(
            `Telegram webhook cleanup failed before polling: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }

    while (!signal.aborted) {
      try {
        const updates = await input.client.getUpdates({
          ...(typeof offset === "number" ? { offset } : {}),
          timeoutSeconds: pollTimeoutSeconds,
          signal
        });

        for (const update of updates) {
          if (signal.aborted) {
            break;
          }
          await input.onUpdate(update);
          offset = update.update_id + 1;
        }
      } catch (error) {
        if (!signal.aborted) {
          input.error?.(
            `Telegram polling failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          await sleep(retryDelayMs, signal);
        }
      }
    }
    input.log?.("Telegram polling stopped.");
  })();

  return {
    stop() {
      controller.abort();
    },
    done
  };
}
