import { z } from "zod";

import {
  createTelegramClient,
  loadWorkspaceChannelConfig,
  type RunEventSink,
  type TelegramClient
} from "@ai-app-template/agent";
import type { SessionSnapshot } from "@ai-app-template/agent";
import {
  THINKING_EFFORT_OPTIONS,
  normalizeThinkingEffort,
  parseInboxCommand,
  type InboxBindingRecord
} from "@ai-app-template/domain";

import type { ApiApp, ApiAppDependencies } from "./app-context.js";
import {
  buildModelCatalog,
  emitPreRunTraceEvent,
  resolveDefaultModel,
  resolveRequestedModel,
  toCreateSessionInput
} from "./app-shared.js";

const telegramWebhookUpdateSchema = z
  .object({
    update_id: z.number().int(),
    message: z
      .object({
        chat: z.object({
          id: z.union([z.string(), z.number()]),
          type: z.string()
        }),
        text: z.string().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const telegramSetWebhookBodySchema = z.object({
  url: z.string().url().optional(),
  dropPendingUpdates: z.boolean().optional()
});

interface ResolvedTelegramChannelConfig {
  enabled: boolean;
  mode: "polling" | "webhook";
  botToken: string | null;
  webhookSecret: string | null;
  webhookUrl: string | null;
}

function resolveTelegramBotToken(
  dependencies: ApiAppDependencies
): string | null {
  const token = dependencies.telegramBotToken?.trim();
  return token && token.length > 0 ? token : null;
}

function resolveTelegramWebhookSecret(
  dependencies: ApiAppDependencies
): string | null {
  const secret = dependencies.telegramWebhookSecret?.trim();
  return secret && secret.length > 0 ? secret : null;
}

async function resolveWorkspaceTelegramChannelConfig(
  dependencies: ApiAppDependencies
): Promise<ResolvedTelegramChannelConfig> {
  const settings = await dependencies.settingsConfigStore.getGlobalSettings();
  const config = await loadWorkspaceChannelConfig(
    settings.workingDirectory
  );
  const telegram = config.telegram;
  if (telegram.configuredInFile) {
    const botToken = telegram.botToken || resolveTelegramBotToken(dependencies);
    return {
      enabled: telegram.enabled,
      mode: telegram.mode,
      botToken: telegram.enabled && botToken ? botToken : null,
      webhookSecret:
        telegram.enabled && telegram.webhookSecret
          ? telegram.webhookSecret
          : null,
      webhookUrl:
        telegram.enabled && telegram.webhookUrl ? telegram.webhookUrl : null
    };
  }

  const botToken = resolveTelegramBotToken(dependencies);
  return {
    enabled: Boolean(botToken),
    mode: "polling",
    botToken,
    webhookSecret: resolveTelegramWebhookSecret(dependencies),
    webhookUrl: null
  };
}

async function resolveTelegramClient(
  dependencies: ApiAppDependencies
): Promise<TelegramClient | null> {
  if (dependencies.telegramClient) {
    return dependencies.telegramClient;
  }

  const { botToken } =
    await resolveWorkspaceTelegramChannelConfig(dependencies);
  if (!botToken) {
    return null;
  }

  return createTelegramClient({ botToken });
}

function formatTelegramHelp(): string {
  return [
    "Commands:",
    "/new [model] [thinkingEffort] - create and select a session",
    "/switch <sessionId> - switch active session",
    "/session - show current session",
    "/model [modelId] - list or switch model",
    "/thinking [high|max] - list or switch thinking effort",
    "/output <final|all> - switch response output mode",
    "/settings - show chatbot settings",
    "/interrupt - interrupt the active run"
  ].join("\n");
}

function formatModelCatalogForTelegram(
  dependencies: ApiAppDependencies
): string {
  const catalog = buildModelCatalog(dependencies);
  if (catalog.models.length === 0) {
    return "No models are configured.";
  }

  return [
    `Default model: ${catalog.defaultModel ?? "none"}`,
    ...catalog.models.map((model) => {
      const thinkingEfforts =
        model.thinkingEfforts.length > 0
          ? `; thinking: ${model.thinkingEfforts.join(", ")}`
          : "";
      const status = model.configured ? "configured" : "unconfigured";
      return `- ${model.id} (${status}${thinkingEfforts})`;
    })
  ].join("\n");
}

function formatSessionStatusForTelegram(session: SessionSnapshot): string {
  return [
    `Session: ${session.sessionId}`,
    `Model: ${session.model}`,
    `Thinking: ${session.context.thinkingEffort}`,
    `Loop state: ${session.sessionState.loopState}`
  ].join("\n");
}

function formatSettingsForTelegram(binding: InboxBindingRecord): string {
  return `Output mode: ${binding.settings.responseOutputMode}`;
}

async function sendTelegramText(input: {
  dependencies: ApiAppDependencies;
  chatId: string;
  text: string;
}): Promise<void> {
  const client = await resolveTelegramClient(input.dependencies);
  if (!client) {
    throw new Error("Telegram bot token is not configured.");
  }

  await client.sendMessage({
    chatId: input.chatId,
    text: input.text
  });
}

async function createInboxSession(input: {
  dependencies: ApiAppDependencies;
  model?: string;
  thinkingEffort?: string;
}): Promise<SessionSnapshot> {
  const settings = await input.dependencies.settingsConfigStore.getGlobalSettings();
  const requestedModel = resolveRequestedModel(input.dependencies, input.model);
  const createInput = toCreateSessionInput({
    settings,
    defaultModel: resolveDefaultModel(input.dependencies),
    modelOverride: requestedModel.model,
    thinkingEffortOverride: input.thinkingEffort,
    workingDirectoryOverride: undefined,
    yoloModeOverride: undefined,
    planModeEnabledOverride: undefined,
    contextWindowOverride: undefined,
    maxTurnsOverride: undefined,
    enabledCapabilityPacksOverride: undefined,
    buildWorkingDirectory: input.dependencies.buildWorkingDirectory
  });

  return input.dependencies.sessionManager.createSession(createInput);
}

async function ensureTelegramActiveSession(input: {
  dependencies: ApiAppDependencies;
  binding: InboxBindingRecord;
}): Promise<{
  binding: InboxBindingRecord;
  session: SessionSnapshot;
}> {
  const repository = input.dependencies.inboxBindingRepository;
  if (!repository) {
    throw new Error("Inbox binding repository is not configured.");
  }

  if (input.binding.activeSessionId) {
    const session = await input.dependencies.sessionManager.getSession(
      input.binding.activeSessionId
    );
    if (session) {
      return { binding: input.binding, session };
    }
  }

  const session = await createInboxSession({
    dependencies: input.dependencies
  });
  const updatedBinding =
    (await repository.updateActiveSession(
      input.binding.id,
      session.sessionId
    )) ?? input.binding;
  return { binding: updatedBinding, session };
}

function getThinkingEffortsForModel(
  dependencies: ApiAppDependencies,
  model: string
): string[] {
  if (!dependencies.modelService) {
    return [...THINKING_EFFORT_OPTIONS];
  }

  return dependencies.modelService.getThinkingEfforts(model);
}

async function handleTelegramCommand(input: {
  dependencies: ApiAppDependencies;
  binding: InboxBindingRecord;
  chatId: string;
  text: string;
}): Promise<InboxBindingRecord> {
  const repository = input.dependencies.inboxBindingRepository;
  if (!repository) {
    throw new Error("Inbox binding repository is not configured.");
  }

  const command = parseInboxCommand(input.text);
  if (command.kind === "message") {
    return input.binding;
  }
  if (command.kind === "invalid") {
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: command.message
    });
    return input.binding;
  }

  if (command.kind === "help") {
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: formatTelegramHelp()
    });
    return input.binding;
  }

  if (command.kind === "new_session") {
    const session = await createInboxSession({
      dependencies: input.dependencies,
      ...(command.model ? { model: command.model } : {}),
      ...(command.thinkingEffort
        ? { thinkingEffort: command.thinkingEffort }
        : {})
    });
    const updatedBinding =
      (await repository.updateActiveSession(
        input.binding.id,
        session.sessionId
      )) ?? input.binding;
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: `Created session ${session.sessionId}.`
    });
    return updatedBinding;
  }

  if (command.kind === "switch_session") {
    const session = await input.dependencies.sessionManager.getSession(
      command.sessionId
    );
    if (!session) {
      await sendTelegramText({
        dependencies: input.dependencies,
        chatId: input.chatId,
        text: `Session not found: ${command.sessionId}`
      });
      return input.binding;
    }

    const updatedBinding =
      (await repository.updateActiveSession(
        input.binding.id,
        session.sessionId
      )) ?? input.binding;
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: `Switched to session ${session.sessionId}.`
    });
    return updatedBinding;
  }

  if (command.kind === "list_models") {
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: formatModelCatalogForTelegram(input.dependencies)
    });
    return input.binding;
  }

  if (command.kind === "set_output_mode") {
    const updatedBinding =
      (await repository.updateSettings(input.binding.id, {
        responseOutputMode: command.outputMode
      })) ?? input.binding;
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: `Output mode set to ${command.outputMode}.`
    });
    return updatedBinding;
  }

  if (command.kind === "settings_status") {
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: formatSettingsForTelegram(input.binding)
    });
    return input.binding;
  }

  if (command.kind === "interrupt") {
    if (!input.binding.activeSessionId) {
      await sendTelegramText({
        dependencies: input.dependencies,
        chatId: input.chatId,
        text: "No active session to interrupt."
      });
      return input.binding;
    }

    const interrupted =
      await input.dependencies.sessionManager.requestInterrupt(
        input.binding.activeSessionId
      );
    const stopped =
      interrupted ??
      (await input.dependencies.sessionManager.forceStop(
        input.binding.activeSessionId
      ));
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: stopped
        ? `Interrupt requested for session ${stopped.sessionId}.`
        : "Active session not found."
    });
    return input.binding;
  }

  const { binding, session } = await ensureTelegramActiveSession({
    dependencies: input.dependencies,
    binding: input.binding
  });

  if (command.kind === "session_status") {
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: formatSessionStatusForTelegram(session)
    });
    return binding;
  }

  if (command.kind === "set_model") {
    const requestedModel = resolveRequestedModel(
      input.dependencies,
      command.model
    );
    const updatedSession = requestedModel.model
      ? await input.dependencies.sessionManager.setModel(
          session.sessionId,
          requestedModel.model
        )
      : session;
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: `Model set to ${updatedSession.model}.`
    });
    return binding;
  }

  if (command.kind === "list_thinking_efforts") {
    const efforts = getThinkingEffortsForModel(
      input.dependencies,
      session.model
    );
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text:
        efforts.length > 0
          ? `Supported thinking efforts: ${efforts.join(", ")}.`
          : `Model ${session.model} does not expose configurable thinking effort.`
    });
    return binding;
  }

  if (command.kind === "set_thinking_effort") {
    const efforts = getThinkingEffortsForModel(
      input.dependencies,
      session.model
    );
    if (efforts.length > 0 && !efforts.includes(command.thinkingEffort)) {
      await sendTelegramText({
        dependencies: input.dependencies,
        chatId: input.chatId,
        text: `Thinking effort ${command.thinkingEffort} is not supported by ${session.model}.`
      });
      return binding;
    }
    if (efforts.length === 0 && input.dependencies.modelService) {
      await sendTelegramText({
        dependencies: input.dependencies,
        chatId: input.chatId,
        text: `Model ${session.model} does not expose configurable thinking effort.`
      });
      return binding;
    }

    const updatedSession =
      await input.dependencies.sessionManager.updateContext(session.sessionId, {
        thinkingEffort: normalizeThinkingEffort(command.thinkingEffort)
      });
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: `Thinking effort set to ${updatedSession.context.thinkingEffort}.`
    });
    return binding;
  }

  return binding;
}

function createTelegramRunEventSink(input: {
  dependencies: ApiAppDependencies;
  chatId: string;
  outputMode: "final" | "all";
}): RunEventSink {
  let latestAssistantText = "";
  let lastSentAssistantText = "";
  const thinkingTurns = new Set<number>();

  async function flushAssistantText(): Promise<void> {
    const text = latestAssistantText.trim();
    if (!text || text === lastSentAssistantText) {
      return;
    }
    latestAssistantText = "";
    lastSentAssistantText = text;
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text
    });
  }

  return async (event) => {
    if (event.kind === "assistant_text") {
      latestAssistantText = event.snapshot ?? event.text;
      return;
    }

    if (input.outputMode === "all") {
      if (event.kind === "thinking" && !thinkingTurns.has(event.turnCount)) {
        thinkingTurns.add(event.turnCount);
        await sendTelegramText({
          dependencies: input.dependencies,
          chatId: input.chatId,
          text: "Thinking..."
        });
        return;
      }

      if (event.kind === "tool_call") {
        await flushAssistantText();
        await sendTelegramText({
          dependencies: input.dependencies,
          chatId: input.chatId,
          text: `Tool call: ${event.toolName}`
        });
        return;
      }

      if (event.kind === "tool_result") {
        await sendTelegramText({
          dependencies: input.dependencies,
          chatId: input.chatId,
          text: `${event.isError ? "Tool failed" : "Tool completed"}: ${
            event.toolName
          }`
        });
        return;
      }
    }

    if (event.kind === "run_complete") {
      if (input.outputMode === "all") {
        await flushAssistantText();
      }
      const finalAnswer = event.finalAnswer?.trim() ?? "";
      if (finalAnswer && finalAnswer !== lastSentAssistantText) {
        lastSentAssistantText = finalAnswer;
        await sendTelegramText({
          dependencies: input.dependencies,
          chatId: input.chatId,
          text: finalAnswer
        });
      }
      return;
    }

    if (event.kind === "run_error") {
      await sendTelegramText({
        dependencies: input.dependencies,
        chatId: input.chatId,
        text: `Run failed: ${event.error}`
      });
    }
  };
}

async function runTelegramMessage(input: {
  dependencies: ApiAppDependencies;
  binding: InboxBindingRecord;
  chatId: string;
  message: string;
}): Promise<InboxBindingRecord> {
  if (!input.dependencies.runtimeFactory) {
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text:
        input.dependencies.runtimeUnavailableMessage ??
        "Runtime is not configured."
    });
    return input.binding;
  }

  const { binding, session } = await ensureTelegramActiveSession({
    dependencies: input.dependencies,
    binding: input.binding
  });
  const isRunning =
    session.sessionState.loopState === "running" ||
    (await input.dependencies.sessionManager.isExecutionActive(
      session.sessionId
    ));
  if (isRunning) {
    await sendTelegramText({
      dependencies: input.dependencies,
      chatId: input.chatId,
      text: "The active session is running. Message ignored. Send /interrupt to stop it."
    });
    return binding;
  }

  const runtimeHandle = await input.dependencies.runtimeFactory(session);
  let terminalEventSeen = false;
  const eventSink = createTelegramRunEventSink({
    dependencies: input.dependencies,
    chatId: input.chatId,
    outputMode: binding.settings.responseOutputMode
  });
  const terminalAwareEventSink: RunEventSink = async (event) => {
    if (event.kind === "run_complete" || event.kind === "run_error") {
      terminalEventSeen = true;
    }
    await eventSink(event);
  };

  try {
    await emitPreRunTraceEvent({
      traceManager: input.dependencies.traceManager,
      sessionId: session.sessionId,
      event: runtimeHandle.preRunTraceEvent,
      eventSink: terminalAwareEventSink
    });
    await runtimeHandle.runtime.run({
      sessionId: session.sessionId,
      message: input.message,
      eventSink: terminalAwareEventSink
    });
  } catch (error) {
    if (!terminalEventSeen) {
      const message =
        error instanceof Error &&
        error.name === "SessionExecutionInProgressError"
          ? "The active session is running. Message ignored. Send /interrupt to stop it."
          : `Run failed: ${error instanceof Error ? error.message : String(error)}`;
      await sendTelegramText({
        dependencies: input.dependencies,
        chatId: input.chatId,
        text: message
      });
    }
  } finally {
    await runtimeHandle.dispose();
  }

  return binding;
}

async function handleTelegramTextMessage(input: {
  dependencies: ApiAppDependencies;
  binding: InboxBindingRecord;
  chatId: string;
  text: string;
}): Promise<InboxBindingRecord> {
  const command = parseInboxCommand(input.text);
  if (command.kind !== "message") {
    return handleTelegramCommand(input);
  }

  return runTelegramMessage({
    dependencies: input.dependencies,
    binding: input.binding,
    chatId: input.chatId,
    message: command.text
  });
}

export function registerTelegramRoutes(input: {
  app: ApiApp;
  dependencies: ApiAppDependencies;
}) {
  const { app, dependencies } = input;

  app.get("/inbox/telegram/status", async (c) => {
    const config = await resolveWorkspaceTelegramChannelConfig(dependencies);
    return c.json({
      configured: Boolean(
        dependencies.inboxBindingRepository &&
        (dependencies.telegramClient || config.botToken)
      ),
      hasWebhookSecret: Boolean(config.webhookSecret),
      webhookUrl: config.webhookUrl,
      mode: config.mode
    });
  });

  app.post("/inbox/telegram/set-webhook", async (c) => {
    const client = await resolveTelegramClient(dependencies);
    if (!client) {
      return c.json({ error: "Telegram bot token is not configured." }, 503);
    }

    const body = telegramSetWebhookBodySchema.parse(await c.req.json());
    const channelConfig =
      await resolveWorkspaceTelegramChannelConfig(dependencies);
    const webhookUrl = body.url || channelConfig.webhookUrl;
    if (!webhookUrl) {
      return c.json({ error: "Telegram webhook URL is not configured." }, 400);
    }
    const result = await client.setWebhook({
      url: webhookUrl,
      ...(channelConfig.webhookSecret
        ? { secretToken: channelConfig.webhookSecret }
        : {}),
      ...(typeof body.dropPendingUpdates === "boolean"
        ? { dropPendingUpdates: body.dropPendingUpdates }
        : {})
    });
    return c.json({ ok: true, result });
  });

  app.post("/inbox/telegram/webhook", async (c) => {
    if (!(await resolveTelegramClient(dependencies))) {
      return c.json({ error: "Telegram bot token is not configured." }, 503);
    }
    if (!dependencies.inboxBindingRepository) {
      return c.json(
        { error: "Inbox binding repository is not configured." },
        503
      );
    }

    const { webhookSecret: expectedSecret } =
      await resolveWorkspaceTelegramChannelConfig(dependencies);
    if (
      expectedSecret &&
      c.req.header("x-telegram-bot-api-secret-token") !== expectedSecret
    ) {
      return c.json({ error: "Invalid Telegram webhook secret." }, 401);
    }

    const update = telegramWebhookUpdateSchema.parse(await c.req.json());
    const message = update.message;
    const text = message?.text?.trim();
    if (!message || message.chat.type !== "private" || !text) {
      return c.json({ ok: true, ignored: "unsupported_update" });
    }

    const chatId = String(message.chat.id);
    const binding = await dependencies.inboxBindingRepository.getOrCreate({
      channel: "telegram",
      externalChatId: chatId
    });
    const processedBinding =
      await dependencies.inboxBindingRepository.markUpdateProcessed(
        binding.id,
        update.update_id
      );
    if (!processedBinding) {
      return c.json({ ok: true, ignored: "duplicate_update" });
    }

    await handleTelegramTextMessage({
      dependencies,
      binding: processedBinding,
      chatId,
      text
    });
    return c.json({ ok: true });
  });
}
