import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  AgentRuntime,
  ModelService,
  RunEventSink,
  SessionSnapshot
} from "@ai-app-template/agent";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MINIMAX_MODEL,
  FileSystemLogManager,
  createLogger,
  type TelegramClient
} from "@ai-app-template/agent";
import {
  createMemoryInboxBindingRepository,
  createMemoryRoutineRepository
} from "@ai-app-template/db";

import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { createTestSettingsConfigStore } from "./helpers/settings-config-store.js";
import { createApiApp } from "../src/app.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

interface TestTelegramMessage {
  chatId: string;
  text: string;
}

function createTelegramClientSpy(): TelegramClient & {
  messages: TestTelegramMessage[];
} {
  const messages: TestTelegramMessage[] = [];
  return {
    messages,
    async sendMessage(message) {
      messages.push(message);
    },
    async setWebhook(input) {
      return { url: input.url };
    },
    async deleteWebhook() {
      return {};
    },
    async getUpdates() {
      return [];
    }
  };
}

function createModelService(): ModelService {
  return {
    listModels() {
      return [
        {
          id: DEFAULT_MINIMAX_MODEL,
          label: "MiniMax 2.7",
          provider: "minimax",
          description: "MiniMax provider",
          configured: true,
          baseURL: "https://api.minimaxi.com/anthropic",
          supportsThinking: true,
          thinkingEfforts: [],
          unavailableReason: null
        },
        {
          id: DEFAULT_DEEPSEEK_MODEL,
          label: "DeepSeek V4 Pro",
          provider: "deepseek",
          description: "DeepSeek provider",
          configured: true,
          baseURL: "https://api.deepseek.com/anthropic",
          supportsThinking: true,
          thinkingEfforts: ["high", "max"],
          unavailableReason: null
        }
      ];
    },
    getDefaultModel() {
      return DEFAULT_MINIMAX_MODEL;
    },
    isModelSupported(model: string) {
      return (
        model === DEFAULT_MINIMAX_MODEL || model === DEFAULT_DEEPSEEK_MODEL
      );
    },
    isModelAvailable(model: string) {
      return (
        model === DEFAULT_MINIMAX_MODEL || model === DEFAULT_DEEPSEEK_MODEL
      );
    },
    supportsThinking() {
      return true;
    },
    getThinkingEfforts(model: string) {
      return model === DEFAULT_DEEPSEEK_MODEL ? ["high", "max"] : [];
    },
    assertModelAvailable(model: string) {
      if (model !== DEFAULT_MINIMAX_MODEL && model !== DEFAULT_DEEPSEEK_MODEL) {
        throw new Error(`Unsupported model: ${model}`);
      }
      return model;
    },
    getClient() {
      throw new Error("Model client is not used in Telegram adapter tests.");
    }
  };
}

async function createTestApp(input?: {
  runtimeFactory?: (session: SessionSnapshot) => Promise<{
    runtime: AgentRuntime;
    dispose(): Promise<void>;
  }>;
  webhookSecret?: string;
}) {
  const sessionManager = await createPostgresTestSessionManager();
  const logDir = await mkdtemp(path.join(os.tmpdir(), "api-log-"));
  const systemLogManager = new FileSystemLogManager(logDir, {
    maxBytes: 4096,
    maxFiles: 2
  });
  const telegramClient = createTelegramClientSpy();
  const inboxBindingRepository = createMemoryInboxBindingRepository();
  const { settingsConfigStore } = await createTestSettingsConfigStore();

  return {
    app: createApiApp({
      sessionManager,
      routineRepository: createMemoryRoutineRepository(),
      settingsConfigStore,
      inboxBindingRepository,
      traceManager: {
        async appendEvent() {},
        async readEvents() {
          return [];
        },
        async deleteEvents() {},
        async truncateEventsAfterTurn() {}
      },
      systemLogManager,
      apiLogger: createLogger({ manager: systemLogManager, component: "api" }),
      buildWorkingDirectory() {
        return workspaceRoot;
      },
      defaultModel: DEFAULT_MINIMAX_MODEL,
      modelService: createModelService(),
      telegramBotToken: "test-token",
      ...(input?.webhookSecret
        ? { telegramWebhookSecret: input.webhookSecret }
        : {}),
      telegramClient,
      ...(input?.runtimeFactory ? { runtimeFactory: input.runtimeFactory } : {})
    }),
    sessionManager,
    inboxBindingRepository,
    telegramClient
  };
}

function createRuntimeFactory(input?: {
  finalAnswer?: string;
  includeProgress?: boolean;
  onRun?: (message: string | undefined) => void;
}) {
  return async (session: SessionSnapshot) => {
    const runtime = {
      async run(runInput: { message?: string; eventSink?: RunEventSink }) {
        input?.onRun?.(runInput.message);
        if (input?.includeProgress) {
          await runInput.eventSink?.({
            kind: "assistant_text",
            sessionId: session.sessionId,
            createdAt: new Date().toISOString(),
            turnCount: 1,
            assistantMessageId: "assistant-progress",
            text: "working",
            snapshot: "working"
          });
          await runInput.eventSink?.({
            kind: "tool_call",
            sessionId: session.sessionId,
            createdAt: new Date().toISOString(),
            turnCount: 1,
            toolCallId: "tool-1",
            toolName: "read_file",
            input: {}
          });
          await runInput.eventSink?.({
            kind: "tool_result",
            sessionId: session.sessionId,
            createdAt: new Date().toISOString(),
            turnCount: 1,
            toolCallId: "tool-1",
            toolName: "read_file",
            output: "ok",
            isError: false
          });
        }

        const finalAnswer = input?.finalAnswer ?? "final answer";
        await runInput.eventSink?.({
          kind: "run_complete",
          sessionId: session.sessionId,
          createdAt: new Date().toISOString(),
          finalAnswer,
          status: "completed",
          stopReason: null,
          toolCallCount: 0,
          toolResultCount: 0,
          toolOutputs: [],
          session
        });
        return {
          session,
          finalAnswer,
          status: "completed" as const,
          stopReason: null,
          toolCallCount: 0,
          toolResultCount: 0,
          toolOutputs: []
        };
      }
    } as unknown as AgentRuntime;

    return {
      runtime,
      async dispose() {}
    };
  };
}

function telegramUpdate(input: {
  updateId: number;
  text: string;
  chatId?: string;
  chatType?: string;
}) {
  return {
    update_id: input.updateId,
    message: {
      chat: {
        id: input.chatId ?? "123",
        type: input.chatType ?? "private"
      },
      text: input.text
    }
  };
}

async function postTelegramWebhook(
  app: ReturnType<typeof createApiApp>,
  body: unknown,
  secret?: string
) {
  return app.request("/inbox/telegram/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Telegram-Bot-Api-Secret-Token": secret } : {})
    },
    body: JSON.stringify(body)
  });
}

describe("Telegram inbox adapter", () => {
  test("creates a binding and session for a private text webhook", async () => {
    const runs: Array<string | undefined> = [];
    const { app, inboxBindingRepository, telegramClient } = await createTestApp(
      {
        runtimeFactory: createRuntimeFactory({
          finalAnswer: "hello from agent",
          onRun(message) {
            runs.push(message);
          }
        })
      }
    );

    const response = await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 1, text: "hello" })
    );

    expect(response.status).toBe(200);
    expect(runs).toEqual(["hello"]);
    expect(telegramClient.messages.map((message) => message.text)).toEqual([
      "hello from agent"
    ]);
    const binding = await inboxBindingRepository.getByChannelExternalChat(
      "telegram",
      "123"
    );
    expect(binding?.activeSessionId).toBeTruthy();
  });

  test("ignores normal messages while the active session is running", async () => {
    const runs: Array<string | undefined> = [];
    const { app, inboxBindingRepository, sessionManager, telegramClient } =
      await createTestApp({
        runtimeFactory: createRuntimeFactory({
          onRun(message) {
            runs.push(message);
          }
        })
      });

    await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 1, text: "/new" })
    );
    const binding = await inboxBindingRepository.getByChannelExternalChat(
      "telegram",
      "123"
    );
    expect(binding?.activeSessionId).toBeTruthy();
    await sessionManager.setLoopState(binding!.activeSessionId!, "running");

    await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 2, text: "second message" })
    );

    expect(runs).toEqual([]);
    expect(telegramClient.messages.at(-1)?.text).toContain("Message ignored");
  });

  test("supports interrupting the active session", async () => {
    const { app, inboxBindingRepository, sessionManager, telegramClient } =
      await createTestApp();

    await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 1, text: "/new" })
    );
    const binding = await inboxBindingRepository.getByChannelExternalChat(
      "telegram",
      "123"
    );
    expect(binding?.activeSessionId).toBeTruthy();
    await sessionManager.setLoopState(binding!.activeSessionId!, "running");

    await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 2, text: "/interrupt" })
    );

    expect(telegramClient.messages.at(-1)?.text).toContain(
      "Interrupt requested"
    );
  });

  test("only sends final answers in final output mode", async () => {
    const { app, telegramClient } = await createTestApp({
      runtimeFactory: createRuntimeFactory({
        finalAnswer: "done",
        includeProgress: true
      })
    });

    await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 1, text: "please work" })
    );

    expect(telegramClient.messages.map((message) => message.text)).toEqual([
      "done"
    ]);
  });

  test("sends progress summaries in all output mode", async () => {
    const { app, telegramClient } = await createTestApp({
      runtimeFactory: createRuntimeFactory({
        finalAnswer: "done",
        includeProgress: true
      })
    });

    await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 1, text: "/output all" })
    );
    await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 2, text: "please work" })
    );

    expect(telegramClient.messages.map((message) => message.text)).toEqual([
      "Output mode set to all.",
      "working",
      "Tool call: read_file",
      "Tool completed: read_file",
      "done"
    ]);
  });

  test("ignores duplicate update ids", async () => {
    const runs: Array<string | undefined> = [];
    const { app, telegramClient } = await createTestApp({
      runtimeFactory: createRuntimeFactory({
        onRun(message) {
          runs.push(message);
        }
      })
    });
    const update = telegramUpdate({ updateId: 1, text: "hello" });

    await postTelegramWebhook(app, update);
    await postTelegramWebhook(app, update);

    expect(runs).toEqual(["hello"]);
    expect(telegramClient.messages).toHaveLength(1);
  });

  test("rejects mismatched webhook secrets", async () => {
    const { app, telegramClient } = await createTestApp({
      webhookSecret: "expected-secret"
    });

    const response = await postTelegramWebhook(
      app,
      telegramUpdate({ updateId: 1, text: "hello" }),
      "wrong-secret"
    );

    expect(response.status).toBe(401);
    expect(telegramClient.messages).toHaveLength(0);
  });
});
