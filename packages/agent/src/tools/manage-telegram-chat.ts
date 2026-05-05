import { promises as fs } from "node:fs";
import path from "node:path";

import type { InboxBindingRecord } from "@ai-app-template/domain";
import type { InboxBindingRepository } from "@ai-app-template/db";
import type { DomainJsonValue } from "@ai-app-template/domain";
import { z } from "zod";

import {
  createTelegramClient,
  loadWorkspaceChannelConfig,
  type TelegramClient
} from "../channels/index.js";
import type { RuntimeTool, ToolExecutionContext } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";
import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";

const MAX_TELEGRAM_DOCUMENT_BYTES = 50 * 1024 * 1024;

const listChatsSchema = z
  .object({
    action: z.literal("list_chats")
  })
  .strict();

const targetSchema = {
  chat_id: z.string().trim().min(1).optional(),
  session_id: z.string().trim().min(1).optional()
} as const;

const sendMessageSchema = z
  .object({
    action: z.literal("send_message"),
    ...targetSchema,
    text: z.string().trim().min(1)
  })
  .strict()
  .refine((value) => !(value.chat_id && value.session_id), {
    message: "Use either chat_id or session_id, not both.",
    path: ["chat_id"]
  });

const sendFileSchema = z
  .object({
    action: z.literal("send_file"),
    ...targetSchema,
    file_path: z.string().trim().min(1),
    filename: z.string().trim().min(1).optional(),
    caption: z.string().trim().max(1024).optional()
  })
  .strict()
  .refine((value) => !(value.chat_id && value.session_id), {
    message: "Use either chat_id or session_id, not both.",
    path: ["chat_id"]
  });

const schema = z.union([listChatsSchema, sendMessageSchema, sendFileSchema]);

type ManageTelegramChatInput = z.infer<typeof schema>;

export interface CreateManageTelegramChatToolOptions {
  inboxBindingRepository?: InboxBindingRepository;
  telegramClient?: TelegramClient;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

function bindingToToolRecord(binding: InboxBindingRecord): DomainJsonValue {
  return {
    binding_id: binding.id,
    chat_id: binding.externalChatId,
    active_session_id: binding.activeSessionId,
    response_output_mode: binding.settings.responseOutputMode,
    updated_at: binding.updatedAt
  };
}

function formatBindingLine(binding: InboxBindingRecord): string {
  return [
    `- chat_id: ${binding.externalChatId}`,
    `active_session_id: ${binding.activeSessionId ?? "none"}`,
    `output: ${binding.settings.responseOutputMode}`,
    `updated: ${binding.updatedAt}`
  ].join(", ");
}

async function listTelegramBindings(
  repository: InboxBindingRepository | undefined
): Promise<
  | { ok: true; bindings: InboxBindingRecord[] }
  | { ok: false; result: ReturnType<typeof failureResult> }
> {
  if (!repository) {
    return {
      ok: false,
      result: failureResult(
        createToolResult({
          ok: false,
          code: "TELEGRAM_BINDINGS_NOT_CONFIGURED",
          message: "Telegram chat bindings are not configured."
        }),
        "[manage_telegram_chat] failed\n- Telegram chat bindings are not configured."
      )
    };
  }

  return { ok: true, bindings: await repository.listByChannel("telegram") };
}

function resolveTargetBinding(input: {
  toolInput: Extract<
    ManageTelegramChatInput,
    { action: "send_message" | "send_file" }
  >;
  sessionId: string;
  bindings: InboxBindingRecord[];
}): InboxBindingRecord | null {
  if (input.toolInput.chat_id) {
    return (
      input.bindings.find(
        (binding) => binding.externalChatId === input.toolInput.chat_id
      ) ?? null
    );
  }

  if (input.toolInput.session_id) {
    return (
      input.bindings.find(
        (binding) => binding.activeSessionId === input.toolInput.session_id
      ) ?? null
    );
  }

  return (
    input.bindings.find(
      (binding) => binding.activeSessionId === input.sessionId
    ) ?? null
  );
}

async function resolveTelegramClient(input: {
  options: CreateManageTelegramChatToolOptions;
  workingDirectory: string;
}): Promise<
  | { ok: true; client: TelegramClient }
  | { ok: false; result: ReturnType<typeof failureResult> }
> {
  if (input.options.telegramClient) {
    return { ok: true, client: input.options.telegramClient };
  }

  const config = await loadWorkspaceChannelConfig(input.workingDirectory);
  const envBotToken = input.options.env?.TELEGRAM_BOT_TOKEN?.trim();
  const botToken = config.telegram.configuredInFile
    ? config.telegram.botToken || envBotToken
    : envBotToken;

  if (config.telegram.configuredInFile && !config.telegram.enabled) {
    return {
      ok: false,
      result: failureResult(
        createToolResult({
          ok: false,
          code: "TELEGRAM_CHANNEL_DISABLED",
          message: "Telegram channel is disabled in workspace config."
        }),
        "[manage_telegram_chat] failed\n- Telegram channel is disabled in workspace config."
      )
    };
  }

  if (!botToken) {
    return {
      ok: false,
      result: failureResult(
        createToolResult({
          ok: false,
          code: "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED",
          message:
            "Telegram bot token is not configured. Set [channels.telegram].bot_token or TELEGRAM_BOT_TOKEN."
        }),
        "[manage_telegram_chat] failed\n- Telegram bot token is not configured."
      )
    };
  }

  return {
    ok: true,
    client: createTelegramClient({
      botToken,
      ...(input.options.fetch ? { fetch: input.options.fetch } : {})
    })
  };
}

async function readTelegramDocument(input: {
  toolInput: Extract<ManageTelegramChatInput, { action: "send_file" }>;
  context: ToolExecutionContext;
}): Promise<
  | {
      ok: true;
      file: Blob;
      filename: string;
      relativePath: string;
      sizeBytes: number;
    }
  | { ok: false; result: ReturnType<typeof failureResult> }
> {
  let resolvedPath: string;
  try {
    resolvedPath = normalizeWorkspacePath(
      input.context.workingDirectory,
      input.toolInput.file_path,
      input.context.allowWorkspaceEscape
    );
  } catch (error) {
    return {
      ok: false,
      result: failureResult(
        createToolResult({
          ok: false,
          code: "WORKSPACE_PATH_ESCAPES",
          message:
            error instanceof Error
              ? error.message
              : "Path escapes the working directory."
        }),
        "[manage_telegram_chat] failed\n- file path escapes the working directory."
      )
    };
  }

  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (error) {
    return {
      ok: false,
      result: failureResult(
        createToolResult({
          ok: false,
          code: "TELEGRAM_FILE_NOT_FOUND",
          message:
            error instanceof Error ? error.message : "Telegram file not found."
        }),
        `[manage_telegram_chat] failed\n- file not found: ${input.toolInput.file_path}`
      )
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      result: failureResult(
        createToolResult({
          ok: false,
          code: "TELEGRAM_FILE_NOT_FILE",
          message: "Telegram file path must point to a regular file."
        }),
        `[manage_telegram_chat] failed\n- path is not a regular file: ${input.toolInput.file_path}`
      )
    };
  }

  if (stat.size > MAX_TELEGRAM_DOCUMENT_BYTES) {
    return {
      ok: false,
      result: failureResult(
        createToolResult({
          ok: false,
          code: "TELEGRAM_FILE_TOO_LARGE",
          message: "Telegram document exceeds the 50 MB tool limit.",
          data: {
            size_bytes: stat.size,
            max_bytes: MAX_TELEGRAM_DOCUMENT_BYTES
          }
        }),
        `[manage_telegram_chat] failed\n- file exceeds 50 MB: ${input.toolInput.file_path}`
      )
    };
  }

  const bytes = await fs.readFile(resolvedPath);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  return {
    ok: true,
    file: new Blob([arrayBuffer], { type: "application/octet-stream" }),
    filename: input.toolInput.filename ?? path.basename(resolvedPath),
    relativePath: toRelativeWorkspacePath(
      input.context.workingDirectory,
      resolvedPath
    ),
    sizeBytes: stat.size
  };
}

export function createManageTelegramChatTool(
  options: CreateManageTelegramChatToolOptions = {}
): RuntimeTool {
  return {
    name: "manage_telegram_chat",
    description: buildToolDescription({
      usageScenarios: [
        "List bound Telegram chats for the workspace.",
        "Send a message or workspace file to a bound Telegram chat from the current or a fresh session."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "action",
          type: 'literal "list_chats" | "send_message" | "send_file"',
          required: true,
          description:
            "Choose whether to list chats, send text, or send a file."
        }),
        describeObjectProperty({
          name: "chat_id",
          type: "string",
          description: "Telegram chat id from action=list_chats."
        }),
        describeObjectProperty({
          name: "session_id",
          type: "string",
          description:
            "Target the Telegram chat whose active session matches this session id."
        }),
        "Omit chat_id and session_id only when the current session is already the active session for a bound Telegram chat.",
        "Use action=list_chats first when the target chat is not known.",
        "For action=send_file, file_path is resolved from the current working directory and filename can override the uploaded display name."
      ],
      constraints: [
        "This tool only sends to Telegram chats that already have an inbox binding.",
        "Telegram must be configured by [channels.telegram].bot_token or TELEGRAM_BOT_TOKEN.",
        "send_file supports regular files up to 50 MB.",
        "Use either chat_id or session_id in one call, not both."
      ],
      examples: [
        '{"action":"list_chats"}',
        '{"action":"send_message","chat_id":"123456789","text":"任务已经完成。"}',
        '{"action":"send_file","chat_id":"123456789","file_path":"artifacts/report.pdf","caption":"报告已生成。"}'
      ]
    }),
    family: "channel",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "destructive-only",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "list_chats" }
          },
          required: ["action"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "send_message" },
            chat_id: { type: "string" },
            session_id: { type: "string" },
            text: { type: "string" }
          },
          required: ["action", "text"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "send_file" },
            chat_id: { type: "string" },
            session_id: { type: "string" },
            file_path: { type: "string" },
            filename: { type: "string" },
            caption: { type: "string" }
          },
          required: ["action", "file_path"],
          additionalProperties: false
        }
      ]
    },
    getSandboxTargets(input) {
      return input.action === "send_file" && typeof input.file_path === "string"
        ? [input.file_path]
        : [];
    },
    async getPermissionRequest(input) {
      const action = typeof input.action === "string" ? input.action : "";
      if (action === "list_chats") {
        return null;
      }
      const target =
        typeof input.chat_id === "string" && input.chat_id.trim()
          ? `chat ${input.chat_id.trim()}`
          : typeof input.session_id === "string" && input.session_id.trim()
            ? `session ${input.session_id.trim()} 的 Telegram chat`
            : "当前 session 绑定的 Telegram chat";
      if (action === "send_file") {
        const filePath =
          typeof input.file_path === "string" ? input.file_path.trim() : "";
        return {
          summaryText: `需要你的确认后才能发送 Telegram 文件到 ${target}。`,
          ...(filePath ? { contextNote: `文件：${filePath}` } : {})
        };
      }
      return {
        summaryText: `需要你的确认后才能发送 Telegram 消息到 ${target}。`
      };
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("manage_telegram_chat", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      const listed = await listTelegramBindings(options.inboxBindingRepository);
      if (!listed.ok) {
        return listed.result;
      }

      if (parsed.data.action === "list_chats") {
        return successResult(
          createToolResult({
            ok: true,
            code: "TELEGRAM_CHATS_LISTED",
            message: "Telegram chats listed successfully.",
            data: {
              telegram_chats: listed.bindings.map(bindingToToolRecord)
            }
          }),
          [
            "[manage_telegram_chat] success",
            "- action: list_chats",
            `- count: ${listed.bindings.length}`,
            ...listed.bindings.map(formatBindingLine)
          ].join("\n")
        );
      }

      const target = resolveTargetBinding({
        toolInput: parsed.data,
        sessionId: context.sessionId,
        bindings: listed.bindings
      });
      if (!target) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "TELEGRAM_CHAT_NOT_FOUND",
            message:
              "Target Telegram chat was not found. Use action=list_chats and send to a bound chat_id or active session_id."
          }),
          "[manage_telegram_chat] failed\n- target Telegram chat was not found."
        );
      }

      const clientResult = await resolveTelegramClient({
        options,
        workingDirectory: context.workingDirectory
      });
      if (!clientResult.ok) {
        return clientResult.result;
      }

      if (parsed.data.action === "send_message") {
        await clientResult.client.sendMessage({
          chatId: target.externalChatId,
          text: parsed.data.text
        });
        return successResult(
          createToolResult({
            ok: true,
            code: "TELEGRAM_MESSAGE_SENT",
            message: "Telegram message sent successfully.",
            data: {
              chat_id: target.externalChatId,
              active_session_id: target.activeSessionId
            }
          }),
          [
            "[manage_telegram_chat] success",
            "- action: send_message",
            `- chat_id: ${target.externalChatId}`
          ].join("\n")
        );
      }

      const document = await readTelegramDocument({
        toolInput: parsed.data,
        context
      });
      if (!document.ok) {
        return document.result;
      }

      await clientResult.client.sendDocument({
        chatId: target.externalChatId,
        file: document.file,
        filename: document.filename,
        ...(parsed.data.caption ? { caption: parsed.data.caption } : {})
      });

      return successResult(
        createToolResult({
          ok: true,
          code: "TELEGRAM_FILE_SENT",
          message: "Telegram file sent successfully.",
          data: {
            chat_id: target.externalChatId,
            active_session_id: target.activeSessionId,
            file_path: document.relativePath,
            filename: document.filename,
            size_bytes: document.sizeBytes
          }
        }),
        [
          "[manage_telegram_chat] success",
          "- action: send_file",
          `- chat_id: ${target.externalChatId}`,
          `- file: ${document.relativePath}`,
          `- size_bytes: ${document.sizeBytes}`
        ].join("\n")
      );
    }
  };
}
