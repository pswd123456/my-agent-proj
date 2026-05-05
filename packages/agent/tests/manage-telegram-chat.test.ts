import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createMemoryInboxBindingRepository,
  type InboxBindingRepository
} from "@ai-app-template/db";

import {
  createTelegramClient,
  createManageTelegramChatTool,
  type TelegramClient
} from "../src/index.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

interface SentMessage {
  chatId: string;
  text: string;
}

interface SentDocument {
  chatId: string;
  filename: string;
  caption?: string;
  text: string;
}

function createTelegramClientSpy(): TelegramClient & {
  messages: SentMessage[];
  documents: SentDocument[];
} {
  const messages: SentMessage[] = [];
  const documents: SentDocument[] = [];
  return {
    messages,
    documents,
    async sendMessage(message) {
      messages.push(message);
    },
    async sendDocument(document) {
      documents.push({
        chatId: document.chatId,
        filename: document.filename,
        ...(document.caption ? { caption: document.caption } : {}),
        text: await document.file.text()
      });
    },
    async setWebhook() {
      return {};
    },
    async deleteWebhook() {
      return {};
    },
    async getUpdates() {
      return [];
    }
  };
}

function createContext(
  workingDirectory: string,
  sessionId = "session-telegram"
): ToolExecutionContext {
  return {
    sessionId,
    workingDirectory,
    routineRepository: undefined as never,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-05-05T00:00:00.000Z",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      todoState: null
    },
    permissionRules: {
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionMessages: []
  };
}

async function createBoundRepository(
  activeSessionId = "session-telegram"
): Promise<InboxBindingRepository> {
  const repository = createMemoryInboxBindingRepository();
  const binding = await repository.getOrCreate({
    channel: "telegram",
    externalChatId: "chat-123"
  });
  await repository.updateActiveSession(binding.id, activeSessionId);
  return repository;
}

describe("manage_telegram_chat tool", () => {
  test("Telegram client sends documents with multipart payloads", async () => {
    let captured: {
      url: string;
      init: RequestInit;
    } | null = null;
    const client = createTelegramClient({
      botToken: "test-token",
      async fetch(url, init) {
        captured = {
          url: String(url),
          init: init ?? {}
        };
        return new Response(JSON.stringify({ ok: true, result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    await client.sendDocument({
      chatId: "chat-123",
      file: new Blob(["report body"], { type: "text/plain" }),
      filename: "report.txt",
      caption: "done"
    });

    expect(captured?.url).toBe(
      "https://api.telegram.org/bottest-token/sendDocument"
    );
    expect(captured?.init.method).toBe("POST");
    const form = captured?.init.body as FormData;
    expect(form.get("chat_id")).toBe("chat-123");
    expect(form.get("caption")).toBe("done");
    expect((form.get("document") as File).name).toBe("report.txt");
  });

  test("lists bound Telegram chats", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "telegram-tool-"));
    const repository = await createBoundRepository();
    const result = await createManageTelegramChatTool({
      inboxBindingRepository: repository,
      telegramClient: createTelegramClientSpy()
    }).execute({ action: "list_chats" }, createContext(workspace));

    expect(result.state).toBe("success");
    expect(result.displayText).toContain("chat_id: chat-123");
    expect(JSON.parse(result.content).data.telegram_chats).toEqual([
      expect.objectContaining({
        chat_id: "chat-123",
        active_session_id: "session-telegram"
      })
    ]);
  });

  test("sends a message to the current session Telegram binding", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "telegram-tool-"));
    const repository = await createBoundRepository();
    const telegramClient = createTelegramClientSpy();
    const result = await createManageTelegramChatTool({
      inboxBindingRepository: repository,
      telegramClient
    }).execute(
      { action: "send_message", text: "hello from agent" },
      createContext(workspace)
    );

    expect(result.state).toBe("success");
    expect(telegramClient.messages).toEqual([
      { chatId: "chat-123", text: "hello from agent" }
    ]);
  });

  test("sends a workspace file to an explicit Telegram chat", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "telegram-tool-"));
    await writeFile(path.join(workspace, "report.txt"), "report body", "utf8");
    const repository = await createBoundRepository();
    const telegramClient = createTelegramClientSpy();
    const result = await createManageTelegramChatTool({
      inboxBindingRepository: repository,
      telegramClient
    }).execute(
      {
        action: "send_file",
        chat_id: "chat-123",
        file_path: "report.txt",
        caption: "done"
      },
      createContext(workspace, "fresh-session")
    );

    expect(result.state).toBe("success");
    expect(telegramClient.documents).toEqual([
      {
        chatId: "chat-123",
        filename: "report.txt",
        caption: "done",
        text: "report body"
      }
    ]);
  });

  test("rejects sends to unbound chats", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "telegram-tool-"));
    const result = await createManageTelegramChatTool({
      inboxBindingRepository: await createBoundRepository(),
      telegramClient: createTelegramClientSpy()
    }).execute(
      { action: "send_message", chat_id: "chat-missing", text: "hello" },
      createContext(workspace)
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("TELEGRAM_CHAT_NOT_FOUND");
  });
});
