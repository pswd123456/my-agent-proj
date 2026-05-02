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
  findDuplicateWorkspaceMcpServerNames,
  invertUnifiedPatch,
  loadWorkspaceMcpTools,
  ModelUnavailableError,
  normalizeWorkspaceMcpServerConfigs,
  parseUnifiedPatch,
  readManageableWorkspaceMcpConfig,
  resolveTaskBriefPathForFork,
  replaceWorkspaceMcpConfigServers,
  sessionFileChangeActionRequestSchema,
  sessionFileChangeActionResultSchema,
  sessionWorkspaceGitStatusSchema,
  searchWorkspaceFiles,
  searchWorkspaceSkills,
  UnsupportedModelError,
  updateUserSettingsMcpPayloadSchema,
  userSettingsMcpPayloadSchema,
  type ModelCatalogEntry,
  type ModelService,
  type RunEventSink,
  type RunSessionResult,
  type SessionFileChangeActionRequest,
  type UpdateUserSettingsMcpPayload,
  type UserSettingsMcpPayload,
  workspaceFileSearchResultSchema,
  workspaceSearchQuerySchema,
  workspaceSkillSearchResultSchema
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
import {
  DEFAULT_SESSION_SETTINGS_USER_ID,
  createSessionPayloadSchema,
  executeSessionPayloadSchema,
  isWorkspaceSkillEnabled,
  normalizeThinkingEffort,
  normalizeCapabilityPacks,
  normalizeSettingsPermissionRules,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns,
  updateSessionSettingsPayloadSchema,
  updateUserSettingsPayloadSchema,
  type SettingsPermissionToolOption,
  type UpdateUserSettingsPayload,
  type WorkspaceSkillSettingRecord
} from "@ai-app-template/domain";
import type { SessionSettingsRecord } from "@ai-app-template/domain";
import type {
  BackgroundTaskRepository,
  RoutineRepository,
  SettingsRepository
} from "@ai-app-template/db";

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
      "api"
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().optional()
});

export interface ApiAppDependencies {
  sessionManager: SessionManager;
  routineRepository: RoutineRepository;
  settingsRepository: SettingsRepository;
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
  defaultUserId?: string;
  runtimeUnavailableMessage?: string;
}

function buildSettingsPermissionMetadata(
  dependencies: ApiAppDependencies
): SettingsPermissionToolOption[] {
  return listSettingsPermissionToolOptions({
    workingDirectory: dependencies.buildWorkingDirectory(),
    routineRepository: dependencies.routineRepository
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

function resolveUserId(
  dependencies: ApiAppDependencies,
  userId: string | undefined
): string {
  const candidate = userId?.trim();
  if (candidate) {
    return candidate;
  }

  return dependencies.defaultUserId ?? DEFAULT_SESSION_SETTINGS_USER_ID;
}

function toCreateSessionInput(input: {
  settings: SessionSettingsRecord;
  defaultModel: string | undefined;
  modelOverride: string | undefined;
  thinkingEffortOverride: string | undefined;
  userId: string;
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
  userId: string;
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
    userId: input.userId,
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

function buildMessageHookContentSet(
  settings: Pick<SessionSettingsRecord, "userContextHooks">
): Set<string> {
  return new Set(
    (settings.userContextHooks ?? [])
      .filter(
        (hook) =>
          hook.enabled &&
          (hook.behavior ?? (hook.event === "run_end" ? "message" : "context")) ===
            "message" &&
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

function countTraceInputTokensBeforeTurn(
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

    return total + Math.max(0, record.event.usage.inputTokens ?? 0);
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
    const userId = resolveUserId(dependencies, body.userId);
    const settings = await dependencies.settingsRepository.getOrCreate(userId);
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const createInput = toCreateSessionInput({
      settings,
      defaultModel: resolveDefaultModel(dependencies),
      modelOverride: requestedModel.model,
      thinkingEffortOverride: body.thinkingEffort,
      userId,
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
      details: { userId, workingDirectory: session.workingDirectory }
    });
    return c.json({ session }, 201);
  });

  app.get("/users/:userId/settings", async (c) => {
    const settings = await dependencies.settingsRepository.getOrCreate(
      resolveUserId(dependencies, c.req.param("userId"))
    );
    return c.json({ settings, permissionTools: settingsPermissionTools });
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

  app.get("/users/:userId/settings/mcp", async (c) => {
    const userId = resolveUserId(dependencies, c.req.param("userId"));
    const settings = await dependencies.settingsRepository.getOrCreate(userId);
    return c.json(await buildUserSettingsMcpPayload(settings.workingDirectory));
  });

  app.put("/users/:userId/settings/mcp", async (c) => {
    const userId = resolveUserId(dependencies, c.req.param("userId"));
    const settings = await dependencies.settingsRepository.getOrCreate(userId);
    const body = updateUserSettingsMcpPayloadSchema.parse(await c.req.json());
    if (hasDuplicateMcpServerNames(body.servers)) {
      return c.json({ error: "MCP server names must be unique." }, 400);
    }

    const servers: Parameters<typeof replaceWorkspaceMcpConfigServers>[1] =
      normalizeWorkspaceMcpServerConfigs(
        body.servers as Parameters<typeof normalizeWorkspaceMcpServerConfigs>[0]
      );
    await replaceWorkspaceMcpConfigServers(settings.workingDirectory, servers);
    return c.json(await buildUserSettingsMcpPayload(settings.workingDirectory));
  });

  app.get("/users/:userId/settings/skills", async (c) => {
    const userId = resolveUserId(dependencies, c.req.param("userId"));
    const settings = await dependencies.settingsRepository.getOrCreate(userId);
    return c.json(
      await buildUserSettingsSkillsPayload(
        settings.workingDirectory,
        settings.workspaceSkillSettings
      )
    );
  });

  app.patch("/users/:userId/settings", async (c) => {
    const userId = resolveUserId(dependencies, c.req.param("userId"));
    const body = updateUserSettingsPayloadSchema.parse(await c.req.json());
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const settings = await dependencies.settingsRepository.update(userId, {
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
      event: "session_interrupt_requested",
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
    const settings = await dependencies.settingsRepository.getOrCreate(
      session.context.userId
    );
    const rewriteTarget = resolveLatestRewriteTarget({
      session,
      checkpoints,
      messageHookContents: buildMessageHookContentSet(settings)
    });
    return c.json({
      sessionId,
      forkTargets: checkpoints.map(toSessionForkTarget),
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
    const settings = await dependencies.settingsRepository.getOrCreate(
      session.context.userId
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
    const nextInputTokensCount = countTraceInputTokensBeforeTurn(
      traceRecords,
      rewriteTarget.turnCount
    );
    let recoveredSession = await dependencies.sessionManager.recover(
      rewindSnapshot
    );
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
      forkTargets: nextCheckpoints.map(toSessionForkTarget),
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
    const requestId = getRequestId(c);
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
    const session =
      await dependencies.sessionManager.requestInterrupt(sessionId);
    if (session) {
      return c.json({
        sessionId,
        accepted: true,
        mode: "interrupt_requested",
        session
      });
    }

    const stoppedSession =
      await dependencies.sessionManager.forceStop(sessionId);
    if (!stoppedSession) {
      return c.json({ error: "Session not found." }, 404);
    }

    await logApiEvent({
      logger: dependencies.apiLogger,
      requestId,
      event: "session_force_stopped_without_active_run",
      sessionId
    });

    return c.json({
      sessionId,
      accepted: true,
      mode: "force_stopped",
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
      mode: "force_stopped",
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
        returned: result.records.length
      }
    });
    return c.json(result);
  });

  app.get("/sessions/:sessionId/trace", async (c) => {
    const requestId = getRequestId(c);
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
      session.context.userId,
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

    const resetCount = await dependencies.routineRepository.resetAll(
      session.context.userId
    );

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
