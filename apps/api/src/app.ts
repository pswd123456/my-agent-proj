import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  listSettingsPermissionToolOptions,
  applyUnifiedPatch,
  cloneForkSessionSnapshot,
  copyTaskBriefForFork,
  createRewriteRewindSnapshot,
  createRunErrorEvent,
  createRunTraceEvent,
  discoverWorkspaceSkills,
  getCheckpointTriggerUserBlock,
  isForkCheckpointForFinalResponse,
  findDuplicateWorkspaceMcpServerNames,
  invertUnifiedPatch,
  loadWorkspaceChannelConfig,
  loadWorkspaceMcpTools,
  ModelUnavailableError,
  normalizeWorkspaceMcpServerConfigs,
  parseUnifiedPatch,
  readManageableWorkspaceChannelConfig,
  readManageableWorkspaceMcpConfig,
  replaceWorkspaceChannelConfig,
  resolveTaskBriefPathForFork,
  replaceWorkspaceMcpConfigServers,
  sessionFileChangeActionRequestSchema,
  sessionFileChangeActionResultSchema,
  sessionWorkspaceGitStatusSchema,
  searchWorkspaceFiles,
  searchWorkspaceSkills,
  UnsupportedModelError,
  updateUserSettingsChannelsPayloadSchema,
  updateUserSettingsMcpPayloadSchema,
  userSettingsChannelsPayloadSchema,
  userSettingsMcpPayloadSchema,
  type ModelCatalogEntry,
  type ModelService,
  type RunEventSink,
  type RunSessionResult,
  type SessionFileChangeActionRequest,
  type UserSettingsChannelsPayload,
  type UpdateUserSettingsMcpPayload,
  type UserSettingsMcpPayload,
  workspaceFileSearchResultSchema,
  workspaceSkillSearchResultSchema,
  createTelegramClient,
  type TelegramClient
} from "@ai-app-template/agent";
import type {
  AgentRuntime,
  JsonValue,
  Logger,
  SessionManager,
  SessionForkCheckpoint,
  SessionForkTarget,
  SessionRewriteTarget,
  SessionSnapshot,
  SystemLogManager,
  TraceEvent,
  TraceManager
} from "@ai-app-template/agent";
import type { SettingsConfigStore } from "@ai-app-template/agent";
import {
  THINKING_EFFORT_OPTIONS,
  createSessionPayloadSchema,
  executeSessionPayloadSchema,
  parseInboxCommand,
  isWorkspaceSkillEnabled,
  normalizeThinkingEffort,
  normalizeCapabilityPacks,
  normalizeSettingsPermissionRules,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns,
  updateSessionSettingsPayloadSchema,
  updateUserSettingsPayloadSchema,
  type InboxBindingRecord,
  type SettingsPermissionToolOption,
  type WorkspaceSkillSettingRecord
} from "@ai-app-template/domain";
import type { SessionSettingsRecord } from "@ai-app-template/domain";
import type {
  BackgroundTaskRepository,
  InboxBindingRepository,
  RoutineRepository
} from "@ai-app-template/db";

import type { CronJobRepository } from "./cron-jobs.js";
import {
  createCronJobBodySchema,
  cronJobResponseSchema,
  listCronJobsResponseSchema,
  updateCronJobBodySchema
} from "./cron-jobs.js";
import {
  collectSessionTreeSessionIds,
  enrichSessionSnapshotsWithParentRelation
} from "./session-relations.js";
import { getSessionWorkspaceGitStatus } from "./session-git-status.js";

export interface ApiAppContext {
  Variables: {
    requestId: string;
  };
}

const createSessionForkBodySchema = z
  .object({
    checkpointId: z.string().optional(),
    assistantMessageId: z.string().optional()
  })
  .refine(
    (value) =>
      (typeof value.checkpointId === "string" &&
        value.checkpointId.trim().length > 0) ||
      (typeof value.assistantMessageId === "string" &&
        value.assistantMessageId.trim().length > 0),
    {
      message: "checkpointId or assistantMessageId is required."
    }
  );

const recoverRewriteTargetBodySchema = z.object({
  checkpointId: z.string().min(1),
  userMessageId: z.string().min(1)
});

function hasDuplicateMcpServerNames(
  servers: UpdateUserSettingsMcpPayload["servers"]
): boolean {
  return findDuplicateWorkspaceMcpServerNames(servers).length > 0;
}

const chooseDirectoryBodySchema = z.object({
  startDirectory: z.string().optional()
});

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

const searchWorkspaceQuerySchema = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

function normalizeSessionSearchQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchesSessionSearch(
  session: SessionSnapshot,
  normalizedQuery: string
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  if (session.sessionId.toLocaleLowerCase().includes(normalizedQuery)) {
    return true;
  }

  return session.messages.some((block) => {
    if (block.kind !== "user" && block.kind !== "assistant") {
      return false;
    }

    return block.content.toLocaleLowerCase().includes(normalizedQuery);
  });
}

const recoverSessionBodySchema = z.object({
  snapshot: z.unknown()
});

const listRoutinesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const systemLogsQuerySchema = z.object({
  sessionId: z.string().optional(),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  component: z
    .enum([
      "runtime",
      "permission",
      "tool-execution",
      "confirmation",
      "interrupt",
      "api",
      "worker",
      "gateway"
    ])
    .optional(),
  runId: z.string().optional(),
  requestId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().optional()
});

export interface ApiAppDependencies {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  cronJobRepository?: CronJobRepository;
  settingsConfigStore: SettingsConfigStore;
  inboxBindingRepository?: InboxBindingRepository;
  backgroundTaskRepository?: BackgroundTaskRepository;
  traceManager: TraceManager;
  systemLogManager: SystemLogManager;
  apiLogger?: Logger;
  buildWorkingDirectory(input?: string): string;
  pickDirectory?(input?: { startDirectory?: string }): Promise<string | null>;
  runtimeFactory?: (session: SessionSnapshot) => Promise<{
    runtime: AgentRuntime;
    dispose(): Promise<void>;
    preRunTraceEvent?: TraceEvent;
  }>;
  modelService?: ModelService;
  defaultModel?: string;
  telegramBotToken?: string;
  telegramWebhookSecret?: string;
  telegramClient?: TelegramClient;
  runtimeUnavailableMessage?: string;
}

function buildSettingsPermissionMetadata(
  dependencies: ApiAppDependencies
): SettingsPermissionToolOption[] {
  return listSettingsPermissionToolOptions({
    workingDirectory: dependencies.buildWorkingDirectory()
  });
}

async function buildUserSettingsMcpPayload(
  workingDirectory: string
): Promise<UserSettingsMcpPayload> {
  const config = await readManageableWorkspaceMcpConfig(workingDirectory);
  const loadResult = await loadWorkspaceMcpTools(workingDirectory);

  try {
    return userSettingsMcpPayloadSchema.parse({
      workingDirectory,
      ...config,
      serverStatuses: loadResult.servers
    });
  } finally {
    await loadResult.dispose();
  }
}

async function buildUserSettingsChannelsPayload(
  workingDirectory: string
): Promise<UserSettingsChannelsPayload> {
  const config = await readManageableWorkspaceChannelConfig(workingDirectory);

  return userSettingsChannelsPayloadSchema.parse({
    workingDirectory,
    ...config
  });
}

async function buildUserSettingsSkillsPayload(
  workingDirectory: string,
  workspaceSkillSettings: readonly WorkspaceSkillSettingRecord[]
) {
  const discovery = await discoverWorkspaceSkills(workingDirectory);

  return {
    workingDirectory,
    skills: discovery.skills.map((skill) => ({
      ...skill,
      enabled: isWorkspaceSkillEnabled(workspaceSkillSettings, skill.name)
    })),
    diagnostics: discovery.diagnostics
  };
}

function resolveDefaultModel(
  dependencies: ApiAppDependencies
): string | undefined {
  return (
    dependencies.modelService?.getDefaultModel() ?? dependencies.defaultModel
  );
}

function buildModelCatalog(dependencies: ApiAppDependencies): {
  defaultModel: string | null;
  models: ModelCatalogEntry[];
} {
  if (dependencies.modelService) {
    return {
      defaultModel: dependencies.modelService.getDefaultModel(),
      models: dependencies.modelService.listModels()
    };
  }

  const defaultModel = resolveDefaultModel(dependencies) ?? null;
  return {
    defaultModel,
    models: defaultModel
      ? [
          {
            id: defaultModel as ModelCatalogEntry["id"],
            label: defaultModel,
            provider: "minimax",
            description: "当前默认模型。",
            configured: true,
            baseURL: "",
            supportsThinking: true,
            thinkingEfforts: [],
            unavailableReason: null
          }
        ]
      : []
  };
}

function resolveRequestedModel(
  dependencies: ApiAppDependencies,
  model: string | undefined
): { model?: string } {
  const candidate = model?.trim();
  if (!candidate) {
    return {};
  }

  if (!dependencies.modelService) {
    return { model: candidate };
  }

  return {
    model: dependencies.modelService.assertModelAvailable(candidate)
  };
}

function toCreateSessionInput(input: {
  settings: SessionSettingsRecord;
  defaultModel: string | undefined;
  modelOverride: string | undefined;
  thinkingEffortOverride: string | undefined;
  workingDirectoryOverride: string | undefined;
  yoloModeOverride: boolean | undefined;
  planModeEnabledOverride: boolean | undefined;
  contextWindowOverride: number | undefined;
  maxTurnsOverride: number | undefined;
  enabledCapabilityPacksOverride: string[] | undefined;
  buildWorkingDirectory: ApiAppDependencies["buildWorkingDirectory"];
}): {
  workingDirectory: string;
  model?: string;
  thinkingEffort: ReturnType<typeof normalizeThinkingEffort>;
  yoloMode: boolean;
  planModeEnabled?: boolean;
  contextWindow: number;
  maxTurns: number;
  shellAllowPatterns: string[];
  shellDenyPatterns: string[];
  toolAllowList: string[];
  toolAskList: string[];
  toolDenyList: string[];
  enabledCapabilityPacks: string[];
} {
  return {
    workingDirectory: input.buildWorkingDirectory(
      input.workingDirectoryOverride ?? input.settings.workingDirectory
    ),
    ...((input.modelOverride ?? input.settings.model ?? input.defaultModel)
      ? {
          model:
            input.modelOverride ?? input.settings.model ?? input.defaultModel
        }
      : {}),
    thinkingEffort: normalizeThinkingEffort(
      input.thinkingEffortOverride ?? input.settings.thinkingEffort
    ),
    yoloMode: input.yoloModeOverride ?? input.settings.yoloMode,
    ...(typeof input.planModeEnabledOverride === "boolean"
      ? { planModeEnabled: input.planModeEnabledOverride }
      : {}),
    contextWindow: sanitizeContextWindow(
      input.contextWindowOverride ?? input.settings.contextWindow
    ),
    maxTurns: sanitizeSessionMaxTurns(
      input.maxTurnsOverride ?? input.settings.maxTurns
    ),
    shellAllowPatterns: input.settings.shellAllowPatterns,
    shellDenyPatterns: input.settings.shellDenyPatterns,
    toolAllowList: input.settings.toolAllowList,
    toolAskList: input.settings.toolAskList,
    toolDenyList: input.settings.toolDenyList,
    enabledCapabilityPacks:
      input.enabledCapabilityPacksOverride ??
      input.settings.enabledCapabilityPacks
  };
}

function toSessionForkTarget(
  checkpoint: SessionForkCheckpoint
): SessionForkTarget {
  return {
    checkpointId: checkpoint.id,
    assistantMessageId: checkpoint.assistantMessageId,
    turnCount: checkpoint.turnCount,
    responseGroupId: checkpoint.responseGroupId ?? null,
    canFork: true
  };
}

function listForkableCheckpoints(
  checkpoints: SessionForkCheckpoint[]
): SessionForkCheckpoint[] {
  return checkpoints.filter(isForkCheckpointForFinalResponse);
}

function buildMessageHookContentSet(
  settings: Pick<SessionSettingsRecord, "userContextHooks">
): Set<string> {
  return new Set(
    (settings.userContextHooks ?? [])
      .filter(
        (hook) =>
          hook.enabled &&
          (hook.behavior ??
            (hook.event === "run_end" ? "message" : "context")) === "message" &&
          hook.content.trim().length > 0
      )
      .map((hook) => hook.content.trim())
  );
}

function resolveLatestRewriteTarget(input: {
  session: SessionSnapshot;
  checkpoints: SessionForkCheckpoint[];
  messageHookContents: Set<string>;
}): SessionRewriteTarget | null {
  for (let index = input.checkpoints.length - 1; index >= 0; index -= 1) {
    const checkpoint = input.checkpoints[index];
    if (!checkpoint) {
      continue;
    }

    const triggerBlock = getCheckpointTriggerUserBlock({
      session: input.session,
      checkpoint
    });
    if (!triggerBlock) {
      continue;
    }

    if (triggerBlock.source === "hook_message") {
      continue;
    }

    if (
      typeof triggerBlock.source !== "string" &&
      input.messageHookContents.has(triggerBlock.content.trim())
    ) {
      return null;
    }

    return {
      checkpointId: checkpoint.id,
      userMessageId: triggerBlock.id,
      turnCount: checkpoint.turnCount
    };
  }

  return null;
}

function countTraceContextTokensBeforeTurn(
  events: Awaited<ReturnType<TraceManager["readEvents"]>>,
  turnCount: number
): number {
  return events.reduce((total, record) => {
    if (
      record.event.kind !== "response" ||
      record.event.turnCount >= turnCount
    ) {
      return total;
    }

    return (
      total +
      Math.max(
        0,
        (record.event.usage.inputTokens ?? 0) +
          (record.event.usage.cacheReadInputTokens ?? 0) +
          (record.event.usage.cacheCreationInputTokens ?? 0)
      )
    );
  }, 0);
}

function resolveForkTaskBriefPath(input: {
  sourceSession: SessionSnapshot;
  targetSessionId: string;
}): string | null {
  return resolveTaskBriefPathForFork({
    workingDirectory: input.sourceSession.workingDirectory,
    sourceSessionId: input.sourceSession.sessionId,
    sourceTaskBriefPath: input.sourceSession.context.taskBriefPath,
    targetSessionId: input.targetSessionId,
    planModeEnabled: input.sourceSession.context.planModeEnabled
  });
}

async function createForkSessionFromCheckpoint(input: {
  dependencies: ApiAppDependencies;
  sourceSession: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}): Promise<SessionSnapshot> {
  const forkSessionId = randomUUID();
  const forkTaskBriefPath = resolveForkTaskBriefPath({
    sourceSession: input.sourceSession,
    targetSessionId: forkSessionId
  });
  const forkSnapshot = cloneForkSessionSnapshot({
    checkpoint: input.checkpoint,
    sessionId: forkSessionId,
    taskBriefPath: forkTaskBriefPath
  });

  await input.dependencies.sessionManager.recover(forkSnapshot);
  await copyTaskBriefForFork({
    sourceTaskBriefPath: input.sourceSession.context.taskBriefPath,
    targetTaskBriefPath: forkTaskBriefPath
  });

  return forkSnapshot;
}

function encodeSseEvent<T extends { kind: string }>(event: T): Uint8Array {
  const payload = JSON.stringify(event);
  return new TextEncoder().encode(`event: ${event.kind}\ndata: ${payload}\n\n`);
}

function enqueueRunErrorEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: {
    sessionId: string;
    session: SessionSnapshot | null;
    error: string;
    toolCallCount: number;
    toolResultCount: number;
    toolOutputs: RunSessionResult["toolOutputs"];
  }
): void {
  try {
    controller.enqueue(
      encodeSseEvent(
        createRunErrorEvent({
          sessionId: input.sessionId,
          session: input.session,
          error: input.error,
          status: "failed",
          stopReason: null,
          toolCallCount: input.toolCallCount,
          toolResultCount: input.toolResultCount,
          toolOutputs: input.toolOutputs
        })
      )
    );
  } catch {
    // If the stream is already closed, there is nothing left to report.
  }
}

function getRequestId(c: {
  req: { header(name: string): string | undefined };
  get(name: "requestId"): string | undefined;
}): string {
  const scopedRequestId = c.get("requestId");
  if (scopedRequestId) {
    return scopedRequestId;
  }

  const headerRequestId = c.req.header("x-request-id")?.trim();
  return headerRequestId || randomUUID();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => toJsonValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, entry]) => [key, toJsonValue(entry)])
    );
  }

  return String(value);
}

function getErrorStatus(error: unknown): number {
  if (error instanceof z.ZodError) {
    return 400;
  }

  if (error instanceof SyntaxError) {
    return 400;
  }

  if (
    error instanceof UnsupportedModelError ||
    error instanceof ModelUnavailableError
  ) {
    return 400;
  }

  return 500;
}

function getErrorCode(error: unknown): string | undefined {
  if (error instanceof z.ZodError) {
    return "validation_error";
  }

  if (isPlainObject(error) && typeof error.code === "string") {
    return error.code;
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Internal Server Error";
}

function getErrorDetails(error: unknown): JsonValue | undefined {
  if (error instanceof z.ZodError) {
    return {
      issues: error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.map((segment) => String(segment)),
        message: issue.message
      }))
    };
  }

  const details: Record<string, JsonValue> = {};
  if (error instanceof Error) {
    if (typeof error.stack === "string") {
      details.stack = error.stack;
    }
    if (error.cause !== undefined) {
      details.cause = toJsonValue(error.cause);
    }
  }

  if (!isPlainObject(error)) {
    return Object.keys(details).length > 0 ? details : undefined;
  }

  const fields = [
    "code",
    "severity",
    "severity_local",
    "detail",
    "hint",
    "position",
    "where",
    "schema",
    "table",
    "column",
    "constraint",
    "file",
    "line",
    "routine",
    "query",
    "params"
  ] as const;
  for (const field of fields) {
    if (field in error) {
      details[field] = toJsonValue(error[field]);
    }
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function buildErrorPayload(error: unknown, requestId: string) {
  const details = getErrorDetails(error);
  const status = getErrorStatus(error) as 400 | 500;
  const code = getErrorCode(error);
  const payload: {
    error: {
      message: string;
      name: string;
      requestId: string;
      status: 400 | 500;
      code?: string;
      details?: JsonValue;
    };
  } = {
    error: {
      message: getErrorMessage(error),
      name:
        error instanceof Error && error.name
          ? error.name
          : "InternalServerError",
      requestId,
      status,
      ...(code ? { code } : {}),
      ...(details ? { details } : {})
    }
  };

  return payload;
}

async function logApiEvent(input: {
  logger: Logger | undefined;
  requestId: string;
  event: string;
  level?: "debug" | "info" | "warn" | "error";
  sessionId?: string;
  details?: Record<string, unknown>;
}) {
  const logger = input.logger?.child({
    requestId: input.requestId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {})
  });
  if (!logger) {
    return;
  }

  const details = (input.details ?? null) as JsonValue;
  if (input.level === "debug") {
    await logger.debug(input.event, details);
  } else if (input.level === "warn") {
    await logger.warn(input.event, details);
  } else if (input.level === "error") {
    await logger.error(input.event, details);
  } else {
    await logger.info(input.event, details);
  }
}

async function emitPreRunTraceEvent(input: {
  traceManager: TraceManager;
  eventSink?: RunEventSink;
  sessionId: string;
  event: TraceEvent | undefined;
}) {
  if (!input.event) {
    return;
  }

  await input.traceManager.appendEvent(input.sessionId, input.event);
  if (!input.eventSink) {
    return;
  }

  try {
    await input.eventSink(createRunTraceEvent(input.sessionId, input.event));
  } catch {
    // Ignore stream sink failures so execution can continue.
  }
}

function buildWorkspaceFileChangePatch(input: {
  action: SessionFileChangeActionRequest["action"];
  files: SessionFileChangeActionRequest["files"];
}) {
  const patchFiles = input.files.flatMap((file) => {
    const parsed = parseUnifiedPatch(file.diff);
    if (!parsed.ok) {
      throw new Error(`Invalid diff for ${file.path}: ${parsed.error}`);
    }

    return parsed.value.files;
  });

  if (input.action === "undo") {
    return invertUnifiedPatch({ files: patchFiles });
  }

  return { files: patchFiles };
}

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
  const config = await loadWorkspaceChannelConfig(settings.workingDirectory);
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

export function createApiApp(dependencies: ApiAppDependencies) {
  const app = new Hono<ApiAppContext>();
  const settingsPermissionTools = buildSettingsPermissionMetadata(dependencies);
  const settingsPermissionToolNames = settingsPermissionTools.map(
    (tool) => tool.name
  );

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id")?.trim() || randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });

  app.onError(async (error, c) => {
    const requestId = getRequestId(c);
    const payload = buildErrorPayload(error, requestId);
    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "request_failed",
      level: "error",
      details: payload.error
    });
    const response = c.json(payload, payload.error.status);
    response.headers.set("x-request-id", requestId);
    return response;
  });

  app.get("/", (c) => {
    return c.json({
      name: "my-agent-proj-api",
      status: "ok"
    });
  });

  app.get("/health", (c) => {
    const health = z.object({
      status: z.literal("ok"),
      service: z.literal("api")
    });

    return c.json(
      health.parse({
        status: "ok",
        service: "api"
      })
    );
  });

  app.get("/models", (c) => {
    return c.json(buildModelCatalog(dependencies));
  });

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

  app.get("/sessions", async (c) => {
    const sessions = await dependencies.sessionManager.listSessions();
    const enrichedSessions = await enrichSessionSnapshotsWithParentRelation({
      sessions,
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    return c.json({ sessions: enrichedSessions });
  });

  app.get("/sessions/search", async (c) => {
    const query = searchWorkspaceQuerySchema.parse(c.req.query());
    const normalizedQuery = normalizeSessionSearchQuery(query.q);
    const sessions = await dependencies.sessionManager.listSessions();
    const matchedSessions = sessions.filter((session) =>
      matchesSessionSearch(session, normalizedQuery)
    );
    const enrichedSessions = await enrichSessionSnapshotsWithParentRelation({
      sessions: matchedSessions,
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    return c.json({ sessions: enrichedSessions });
  });

  app.post("/sessions", async (c) => {
    const requestId = getRequestId(c);
    const body = createSessionPayloadSchema.parse(await c.req.json());
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const createInput = toCreateSessionInput({
      settings,
      defaultModel: resolveDefaultModel(dependencies),
      modelOverride: requestedModel.model,
      thinkingEffortOverride: body.thinkingEffort,
      workingDirectoryOverride: body.workingDirectory,
      yoloModeOverride: body.yoloMode,
      planModeEnabledOverride: body.planModeEnabled,
      contextWindowOverride: body.contextWindow,
      maxTurnsOverride: body.maxTurns,
      enabledCapabilityPacksOverride: body.enabledCapabilityPacks,
      buildWorkingDirectory: dependencies.buildWorkingDirectory
    });

    const session =
      await dependencies.sessionManager.createSession(createInput);
    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_created",
      sessionId: session.sessionId,
      details: { workingDirectory: session.workingDirectory }
    });
    return c.json({ session }, 201);
  });

  app.get("/settings", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json({ settings, permissionTools: settingsPermissionTools });
  });

  app.get("/cron-jobs", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const cronJobs = await dependencies.cronJobRepository.list();
    return c.json(listCronJobsResponseSchema.parse({ cronJobs }));
  });

  app.post("/cron-jobs", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const requestId = getRequestId(c);
    const body = createCronJobBodySchema.parse(await c.req.json());
    const requestedModel =
      typeof body.model === "string"
        ? resolveRequestedModel(dependencies, body.model).model
        : undefined;
    const cronJob = await dependencies.cronJobRepository.create({
      ...body,
      workingDirectory: dependencies.buildWorkingDirectory(
        body.workingDirectory
      ),
      ...(requestedModel ? { model: requestedModel } : {})
    });

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "cron_job_created",
      details: { cronJobId: cronJob.id }
    });

    return c.json(cronJobResponseSchema.parse({ cronJob }), 201);
  });

  app.patch("/cron-jobs/:cronJobId", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const requestId = getRequestId(c);
    const cronJobId = c.req.param("cronJobId");
    const body = updateCronJobBodySchema.parse(await c.req.json());
    const requestedModel =
      body.model === null
        ? null
        : typeof body.model === "string"
          ? resolveRequestedModel(dependencies, body.model).model
          : undefined;
    const cronJob = await dependencies.cronJobRepository.update(
      cronJobId,
      {
        ...body,
        ...(typeof body.workingDirectory === "string"
          ? {
              workingDirectory: dependencies.buildWorkingDirectory(
                body.workingDirectory
              )
            }
          : {}),
        ...(typeof requestedModel === "string" || requestedModel === null
          ? { model: requestedModel }
          : {})
      }
    );

    if (!cronJob) {
      return c.json({ error: "Cron job not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "cron_job_updated",
      details: { cronJobId }
    });

    return c.json(cronJobResponseSchema.parse({ cronJob }));
  });

  app.delete("/cron-jobs/:cronJobId", async (c) => {
    if (!dependencies.cronJobRepository) {
      return c.json({ error: "Cron jobs are not configured." }, 503);
    }

    const requestId = getRequestId(c);
    const cronJobId = c.req.param("cronJobId");
    const removed = await dependencies.cronJobRepository.remove(cronJobId);
    if (!removed) {
      return c.json({ error: "Cron job not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "cron_job_deleted",
      details: { cronJobId }
    });

    return c.body(null, 204);
  });

  app.post("/directory-picker", async (c) => {
    if (!dependencies.pickDirectory) {
      return c.json({ error: "Directory picker is not configured." }, 501);
    }

    const body = chooseDirectoryBodySchema.parse(await c.req.json());
    const selectedPath = await dependencies.pickDirectory(
      body.startDirectory ? { startDirectory: body.startDirectory } : undefined
    );
    return c.json({
      path: selectedPath,
      canceled: selectedPath === null
    });
  });

  app.get("/settings/channels", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json(
      await buildUserSettingsChannelsPayload(settings.workingDirectory)
    );
  });

  app.put("/settings/channels", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    const body = updateUserSettingsChannelsPayloadSchema.parse(
      await c.req.json()
    );
    await dependencies.settingsConfigStore.updateWorkspaceChannels(
      settings.workingDirectory,
      {
        enabled: body.telegram.enabled,
        mode: body.telegram.mode,
        botToken: body.telegram.botToken.trim(),
        webhookSecret: body.telegram.webhookSecret.trim(),
        webhookUrl: body.telegram.webhookUrl.trim()
      }
    );
    return c.json(
      await buildUserSettingsChannelsPayload(settings.workingDirectory)
    );
  });

  app.get("/settings/mcp", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json(await buildUserSettingsMcpPayload(settings.workingDirectory));
  });

  app.put("/settings/mcp", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    const body = updateUserSettingsMcpPayloadSchema.parse(await c.req.json());
    if (hasDuplicateMcpServerNames(body.servers)) {
      return c.json({ error: "MCP server names must be unique." }, 400);
    }

    const servers: Parameters<typeof replaceWorkspaceMcpConfigServers>[1] =
      normalizeWorkspaceMcpServerConfigs(
        body.servers as Parameters<typeof normalizeWorkspaceMcpServerConfigs>[0]
      );
    await dependencies.settingsConfigStore.updateWorkspaceMcpServers(
      settings.workingDirectory,
      servers
    );
    return c.json(await buildUserSettingsMcpPayload(settings.workingDirectory));
  });

  app.get("/settings/skills", async (c) => {
    const settings = await dependencies.settingsConfigStore.getGlobalSettings();
    return c.json(
      await buildUserSettingsSkillsPayload(
        settings.workingDirectory,
        settings.workspaceSkillSettings
      )
    );
  });

  app.patch("/settings", async (c) => {
    const body = updateUserSettingsPayloadSchema.parse(await c.req.json());
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const settings = await dependencies.settingsConfigStore.updateGlobalSettings({
      ...(typeof body.workingDirectory === "string"
        ? {
            workingDirectory: dependencies.buildWorkingDirectory(
              body.workingDirectory
            )
          }
        : {}),
      ...(requestedModel.model ? { model: requestedModel.model } : {}),
      ...(typeof body.thinkingEffort === "string"
        ? { thinkingEffort: normalizeThinkingEffort(body.thinkingEffort) }
        : {}),
      ...(typeof body.yoloMode === "boolean"
        ? { yoloMode: body.yoloMode }
        : {}),
      ...(typeof body.contextWindow === "number"
        ? { contextWindow: body.contextWindow }
        : {}),
      ...(typeof body.maxTurns === "number" ? { maxTurns: body.maxTurns } : {}),
      ...(Array.isArray(body.shellAllowPatterns)
        ? { shellAllowPatterns: body.shellAllowPatterns }
        : {}),
      ...(Array.isArray(body.shellDenyPatterns)
        ? { shellDenyPatterns: body.shellDenyPatterns }
        : {}),
      ...(Array.isArray(body.toolAllowList)
        ? { toolAllowList: body.toolAllowList }
        : {}),
      ...(Array.isArray(body.toolAskList)
        ? { toolAskList: body.toolAskList }
        : {}),
      ...(Array.isArray(body.toolDenyList)
        ? { toolDenyList: body.toolDenyList }
        : {}),
      ...(Array.isArray(body.enabledCapabilityPacks)
        ? { enabledCapabilityPacks: body.enabledCapabilityPacks }
        : {}),
      ...(Array.isArray(body.workspaceSkillSettings)
        ? { workspaceSkillSettings: body.workspaceSkillSettings }
        : {}),
      ...(Array.isArray(body.userContextHooks)
        ? { userContextHooks: body.userContextHooks }
        : {}),
      ...(typeof body.debugConversationView === "boolean"
        ? { debugConversationView: body.debugConversationView }
        : {}),
      ...(typeof body.userCustomPrompt === "string"
        ? { userCustomPrompt: body.userCustomPrompt }
        : {})
    });
    return c.json({ settings, permissionTools: settingsPermissionTools });
  });

  app.get("/sessions/:sessionId", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_read",
      sessionId,
      details: { found: Boolean(session) }
    });
    const enrichedSession = (
      await enrichSessionSnapshotsWithParentRelation({
        sessions: [session],
        backgroundTaskRepository: dependencies.backgroundTaskRepository
      })
    )[0];
    return c.json({ session: enrichedSession ?? session });
  });

  app.get("/sessions/:sessionId/fork-targets", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const checkpoints =
      await dependencies.sessionManager.listForkCheckpoints(sessionId);
    const forkableCheckpoints = listForkableCheckpoints(checkpoints);
    const settings = await dependencies.settingsConfigStore.getEffectiveSettings(
      session.workingDirectory
    );
    const rewriteTarget = resolveLatestRewriteTarget({
      session,
      checkpoints,
      messageHookContents: buildMessageHookContentSet(settings)
    });
    return c.json({
      sessionId,
      forkTargets: forkableCheckpoints.map(toSessionForkTarget),
      rewriteTarget
    });
  });

  app.post("/sessions/:sessionId/forks", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const sourceSession =
      await dependencies.sessionManager.getSession(sessionId);
    if (!sourceSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = createSessionForkBodySchema.parse(await c.req.json());
    const checkpoint =
      (typeof body.checkpointId === "string" &&
      body.checkpointId.trim().length > 0
        ? await dependencies.sessionManager.getForkCheckpoint(
            body.checkpointId.trim()
          )
        : null) ??
      (typeof body.assistantMessageId === "string" &&
      body.assistantMessageId.trim().length > 0
        ? await dependencies.sessionManager.findForkCheckpointByAssistantMessage(
            sessionId,
            body.assistantMessageId.trim()
          )
        : null);

    if (!checkpoint || checkpoint.sessionId !== sessionId) {
      return c.json(
        {
          error:
            "Fork checkpoint not found for this message. Historical reconstruction is not available for this target yet."
        },
        404
      );
    }

    if (!isForkCheckpointForFinalResponse(checkpoint)) {
      return c.json(
        {
          error:
            "Only final assistant responses can be forked. Intermediate progress messages are not valid fork targets."
        },
        409
      );
    }

    const forkSession = await createForkSessionFromCheckpoint({
      dependencies,
      sourceSession,
      checkpoint
    });
    const enrichedSession = (
      await enrichSessionSnapshotsWithParentRelation({
        sessions: [forkSession],
        backgroundTaskRepository: dependencies.backgroundTaskRepository
      })
    )[0];

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_fork_created",
      sessionId: forkSession.sessionId,
      details: {
        parentSessionId: sessionId,
        checkpointId: checkpoint.id,
        assistantMessageId: checkpoint.assistantMessageId
      }
    });

    return c.json({ session: enrichedSession ?? forkSession }, 201);
  });

  app.post("/sessions/:sessionId/rewrite-target/recover", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    if (await dependencies.sessionManager.isExecutionActive(sessionId)) {
      return c.json({ error: "Session is still running." }, 409);
    }

    if (
      session.context.pendingPermissionRequest ||
      session.context.pendingConfirmationPayload ||
      session.context.pendingUserQuestionPayload ||
      session.sessionState.pendingToolCallIds.length > 0 ||
      session.sessionState.interruptRequested
    ) {
      return c.json(
        {
          error:
            "Rewrite is available only after a completed user turn with no pending approval or question."
        },
        409
      );
    }

    const body = recoverRewriteTargetBodySchema.parse(await c.req.json());
    const checkpoints =
      await dependencies.sessionManager.listForkCheckpoints(sessionId);
    const settings = await dependencies.settingsConfigStore.getEffectiveSettings(
      session.workingDirectory
    );
    const rewriteTarget = resolveLatestRewriteTarget({
      session,
      checkpoints,
      messageHookContents: buildMessageHookContentSet(settings)
    });
    if (
      !rewriteTarget ||
      rewriteTarget.checkpointId !== body.checkpointId ||
      rewriteTarget.userMessageId !== body.userMessageId
    ) {
      return c.json(
        { error: "Only the latest rewriteable user message can be rewritten." },
        409
      );
    }

    const checkpoint = checkpoints.find(
      (candidate) => candidate.id === rewriteTarget.checkpointId
    );
    if (!checkpoint) {
      return c.json({ error: "Rewrite checkpoint not found." }, 404);
    }

    const rewindSnapshot = createRewriteRewindSnapshot({
      session,
      checkpoint
    });
    const traceRecords = await dependencies.traceManager.readEvents(sessionId);
    const nextTraceRecords = traceRecords.filter(
      (record) => record.event.turnCount < rewriteTarget.turnCount
    );
    const nextInputTokensCount = countTraceContextTokensBeforeTurn(
      traceRecords,
      rewriteTarget.turnCount
    );
    let recoveredSession =
      await dependencies.sessionManager.recover(rewindSnapshot);
    await dependencies.sessionManager.pruneForkCheckpointsFromTurn(
      sessionId,
      rewriteTarget.turnCount
    );
    await dependencies.traceManager.truncateEventsAfterTurn(
      sessionId,
      rewriteTarget.turnCount
    );
    recoveredSession = await dependencies.sessionManager.saveSession({
      ...recoveredSession,
      inputTokensCount: nextInputTokensCount
    });

    const nextCheckpoints =
      await dependencies.sessionManager.listForkCheckpoints(sessionId);
    const nextForkableCheckpoints = listForkableCheckpoints(nextCheckpoints);
    const nextRewriteTarget = resolveLatestRewriteTarget({
      session: recoveredSession,
      checkpoints: nextCheckpoints,
      messageHookContents: buildMessageHookContentSet(settings)
    });

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_rewrite_recovered",
      sessionId,
      details: {
        checkpointId: rewriteTarget.checkpointId,
        userMessageId: rewriteTarget.userMessageId,
        turnCount: rewriteTarget.turnCount
      }
    });

    return c.json({
      session: recoveredSession,
      traceRecords: nextTraceRecords,
      forkTargets: nextForkableCheckpoints.map(toSessionForkTarget),
      rewriteTarget: nextRewriteTarget
    });
  });

  app.patch("/sessions/:sessionId/settings", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = updateSessionSettingsPayloadSchema.parse(await c.req.json());
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const permissionRules = normalizeSettingsPermissionRules(
      {
        shellAllowPatterns:
          body.shellAllowPatterns ?? session.context.shellAllowPatterns,
        shellDenyPatterns:
          body.shellDenyPatterns ?? session.context.shellDenyPatterns,
        toolAllowList: body.toolAllowList ?? session.context.toolAllowList,
        toolAskList: body.toolAskList ?? session.context.toolAskList,
        toolDenyList: body.toolDenyList ?? session.context.toolDenyList
      },
      settingsPermissionToolNames
    );
    let updated = await dependencies.sessionManager.updateContext(sessionId, {
      ...(typeof body.yoloMode === "boolean"
        ? { yoloMode: body.yoloMode }
        : {}),
      ...(typeof body.thinkingEffort === "string"
        ? { thinkingEffort: normalizeThinkingEffort(body.thinkingEffort) }
        : {}),
      ...(typeof body.planModeEnabled === "boolean"
        ? { planModeEnabled: body.planModeEnabled }
        : {}),
      shellAllowPatterns: permissionRules.shellAllowPatterns,
      shellDenyPatterns: permissionRules.shellDenyPatterns,
      toolAllowList: permissionRules.toolAllowList,
      toolAskList: permissionRules.toolAskList,
      toolDenyList: permissionRules.toolDenyList,
      ...(Array.isArray(body.enabledCapabilityPacks)
        ? {
            enabledCapabilityPacks: normalizeCapabilityPacks(
              body.enabledCapabilityPacks
            )
          }
        : {})
    });
    if (requestedModel.model) {
      updated = await dependencies.sessionManager.setModel(
        sessionId,
        requestedModel.model
      );
    }
    return c.json({ session: updated });
  });

  app.get("/sessions/:sessionId/workspace-files/search", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const query = searchWorkspaceQuerySchema.parse(c.req.query());
    const result = await searchWorkspaceFiles({
      workingDirectory: session.workingDirectory,
      query: query.q,
      maxResults: query.limit
    });

    return c.json(
      workspaceFileSearchResultSchema.parse({
        items: result.matches.map((match) => ({
          path: match.path,
          name: match.name
        })),
        truncated: result.truncated
      })
    );
  });

  app.get("/sessions/:sessionId/skills/search", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const query = searchWorkspaceQuerySchema.parse(c.req.query());
    const discovery = await discoverWorkspaceSkills(session.workingDirectory);
    const result = searchWorkspaceSkills({
      skills: discovery.skills,
      query: query.q,
      maxResults: query.limit,
      allowEmptyQuery: true
    });

    return c.json(
      workspaceSkillSearchResultSchema.parse({
        items: result.matches.map((match) => ({
          name: match.name,
          description: match.description,
          relativePath: match.relativePath
        })),
        truncated: result.truncated
      })
    );
  });

  app.get("/sessions/:sessionId/git-status", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json(
      sessionWorkspaceGitStatusSchema.parse(
        await getSessionWorkspaceGitStatus(session.workingDirectory)
      )
    );
  });

  app.delete("/sessions/history", async (c) => {
    const sessions = await enrichSessionSnapshotsWithParentRelation({
      sessions: await dependencies.sessionManager.listSessions(),
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    if (sessions.length === 0) {
      return c.body(null, 204);
    }

    const sessionIdsToDelete = new Set<string>();
    const rootSessions = sessions.filter((session) => {
      const parentSessionId = session.parentSessionId?.trim() ?? null;
      return (
        !parentSessionId ||
        parentSessionId === session.sessionId ||
        !sessions.some((candidate) => candidate.sessionId === parentSessionId)
      );
    });

    for (const rootSession of rootSessions) {
      for (const sessionId of collectSessionTreeSessionIds({
        sessions,
        rootSessionId: rootSession.sessionId
      }).reverse()) {
        sessionIdsToDelete.add(sessionId);
      }
    }

    const isAnyExecutionActive = await Promise.all(
      [...sessionIdsToDelete].map((sessionId) =>
        dependencies.sessionManager.isExecutionActive(sessionId)
      )
    );
    if (isAnyExecutionActive.some(Boolean)) {
      return c.json(
        {
          error:
            "One or more sessions are currently running. Wait for active runs to finish before clearing history."
        },
        409
      );
    }

    for (const sessionId of sessionIdsToDelete) {
      await dependencies.sessionManager.deleteSession(sessionId);
      await dependencies.traceManager.deleteEvents(sessionId);
    }

    return c.body(null, 204);
  });

  app.delete("/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const sessions = await enrichSessionSnapshotsWithParentRelation({
      sessions: await dependencies.sessionManager.listSessions(),
      backgroundTaskRepository: dependencies.backgroundTaskRepository
    });
    const sessionIdsToDelete = collectSessionTreeSessionIds({
      sessions,
      rootSessionId: sessionId
    });
    if (sessionIdsToDelete.length === 0) {
      return c.json({ error: "Session not found." }, 404);
    }

    const isAnyExecutionActive = await Promise.all(
      sessionIdsToDelete.map((id) =>
        dependencies.sessionManager.isExecutionActive(id)
      )
    );
    if (isAnyExecutionActive.some(Boolean)) {
      return c.json(
        {
          error:
            "Session or one of its child sessions is currently running. Wait for active runs to finish before deleting it."
        },
        409
      );
    }

    for (const currentSessionId of [...sessionIdsToDelete].reverse()) {
      await dependencies.sessionManager.deleteSession(currentSessionId);
      await dependencies.traceManager.deleteEvents(currentSessionId);
    }
    return c.body(null, 204);
  });

  app.post("/sessions/:sessionId/interrupt", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const stoppedSession =
      await dependencies.sessionManager.forceStop(sessionId);
    if (!stoppedSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_interrupted",
      sessionId
    });

    return c.json({
      sessionId,
      accepted: true,
      mode: "interrupted",
      session: stoppedSession
    });
  });

  app.post("/sessions/:sessionId/force-stop", async (c) => {
    const requestId = getRequestId(c);
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.forceStop(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_force_stopped",
      sessionId
    });

    return c.json({
      sessionId,
      accepted: true,
      mode: "interrupted",
      session
    });
  });

  app.post("/sessions/:sessionId/file-changes", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = sessionFileChangeActionRequestSchema.parse(await c.req.json());
    const patch = buildWorkspaceFileChangePatch(body);
    try {
      await applyUnifiedPatch({
        workingDirectory: session.workingDirectory,
        patch,
        allowWorkspaceEscape: false
      });

      return c.json(
        sessionFileChangeActionResultSchema.parse({
          sessionId,
          action: body.action,
          files: body.files
        })
      );
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error)
        },
        409
      );
    }
  });

  app.post("/sessions/:sessionId/execute", async (c) => {
    if (!dependencies.runtimeFactory) {
      return c.json(
        {
          error:
            dependencies.runtimeUnavailableMessage ??
            "Runtime is not configured."
        },
        503
      );
    }

    const body = executeSessionPayloadSchema.parse(await c.req.json());
    const sessionId = c.req.param("sessionId");
    const currentSession =
      await dependencies.sessionManager.getSession(sessionId);

    if (!currentSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const runtimeHandle = await dependencies.runtimeFactory(currentSession);
    try {
      await emitPreRunTraceEvent({
        traceManager: dependencies.traceManager,
        sessionId,
        event: runtimeHandle.preRunTraceEvent
      });
      const result = await runtimeHandle.runtime.run({
        sessionId,
        message: body.message,
        ...(typeof body.maxTurns === "number"
          ? { maxTurns: body.maxTurns }
          : {}),
        ...(typeof body.permissionReply === "boolean"
          ? { permissionReply: body.permissionReply }
          : {})
      });

      return c.json(result);
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "SessionExecutionInProgressError"
      ) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    } finally {
      await runtimeHandle.dispose();
    }
  });

  app.post("/sessions/:sessionId/execute/stream", async (c) => {
    if (!dependencies.runtimeFactory) {
      return c.json(
        {
          error:
            dependencies.runtimeUnavailableMessage ??
            "Runtime is not configured."
        },
        503
      );
    }

    const body = executeSessionPayloadSchema.parse(await c.req.json());
    const sessionId = c.req.param("sessionId");
    const currentSession =
      await dependencies.sessionManager.getSession(sessionId);

    if (!currentSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    const runtimeHandle = await dependencies.runtimeFactory(currentSession);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": stream-start\n\n"));

        void (async () => {
          let runtimeTerminalEventSeen = false;
          let runtimeResult: RunSessionResult | null = null;
          const runtimeEventSink: RunEventSink = (event) => {
            if (event.kind === "run_complete" || event.kind === "run_error") {
              runtimeTerminalEventSeen = true;
            }

            controller.enqueue(encodeSseEvent(event));
          };
          try {
            await emitPreRunTraceEvent({
              traceManager: dependencies.traceManager,
              sessionId,
              event: runtimeHandle.preRunTraceEvent,
              eventSink(event) {
                controller.enqueue(encodeSseEvent(event));
              }
            });
            runtimeResult = await runtimeHandle.runtime.run({
              sessionId,
              message: body.message,
              ...(typeof body.maxTurns === "number"
                ? { maxTurns: body.maxTurns }
                : {}),
              ...(typeof body.permissionReply === "boolean"
                ? { permissionReply: body.permissionReply }
                : {}),
              eventSink: runtimeEventSink
            });
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === "SessionExecutionInProgressError"
            ) {
              enqueueRunErrorEvent(controller, {
                sessionId,
                session: null,
                error: error.message,
                toolCallCount: 0,
                toolResultCount: 0,
                toolOutputs: []
              });
            } else if (!runtimeTerminalEventSeen) {
              enqueueRunErrorEvent(controller, {
                sessionId,
                session: currentSession,
                error: error instanceof Error ? error.message : String(error),
                toolCallCount: 0,
                toolResultCount: 0,
                toolOutputs: []
              });
            }
          } finally {
            try {
              await runtimeHandle.dispose();
            } catch (error) {
              if (runtimeResult) {
                enqueueRunErrorEvent(controller, {
                  sessionId,
                  session: runtimeResult.session,
                  error: error instanceof Error ? error.message : String(error),
                  toolCallCount: runtimeResult.toolCallCount,
                  toolResultCount: runtimeResult.toolResultCount,
                  toolOutputs: runtimeResult.toolOutputs
                });
              }
            } finally {
              controller.close();
            }
          }
        })();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  });

  app.post("/sessions/:sessionId/snapshot", async (c) => {
    const session = await dependencies.sessionManager.getSession(
      c.req.param("sessionId")
    );
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json({ snapshot: session });
  });

  app.get("/system-logs", async (c) => {
    const requestId = getRequestId(c);
    const query = systemLogsQuerySchema.parse(c.req.query());
    const result = await dependencies.systemLogManager.query({
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.component ? { component: query.component } : {}),
      ...(query.runId ? { runId: query.runId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(typeof query.limit === "number" ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {})
    });
    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "system_logs_read",
      details: {
        sessionId: query.sessionId ?? null,
        level: query.level ?? null,
        component: query.component ?? null,
        runId: query.runId ?? null,
        recordRequestId: query.requestId ?? null,
        returned: result.records.length
      }
    });
    return c.json(result);
  });

  app.get("/sessions/:sessionId/trace", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const events = await dependencies.traceManager.readEvents(sessionId);
    return c.json({ sessionId, events });
  });

  app.get("/sessions/:sessionId/routines", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const query = listRoutinesQuerySchema.parse(c.req.query());
    const routines = await dependencies.routineRepository.listByDateRange(
      query.startDate,
      query.endDate
    );

    return c.json({
      sessionId,
      startDate: query.startDate,
      endDate: query.endDate,
      routines
    });
  });

  app.post("/sessions/:sessionId/routines/reset", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const resetCount = await dependencies.routineRepository.resetAll();

    return c.json({
      sessionId,
      resetCount
    });
  });

  app.post("/sessions/:sessionId/recover", async (c) => {
    const body = recoverSessionBodySchema.parse(await c.req.json());
    try {
      const snapshot = await dependencies.sessionManager.recover(
        body.snapshot as SessionSnapshot
      );
      return c.json({ session: snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }
  });

  return app;
}
