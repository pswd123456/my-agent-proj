import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  listSettingsPermissionToolOptions,
  applyUnifiedPatch,
  createRunErrorEvent,
  createRunTraceEvent,
  discoverWorkspaceSkills,
  invertUnifiedPatch,
  loadWorkspaceMcpTools,
  ModelUnavailableError,
  parseUnifiedPatch,
  readManageableWorkspaceMcpConfig,
  replaceWorkspaceMcpConfigServers,
  searchWorkspaceFiles,
  searchWorkspaceSkills,
  UnsupportedModelError,
  type ModelCatalogEntry,
  type ModelService,
  type RunEventSink,
  type RunSessionResult
} from "@ai-app-template/agent";
import type {
  AgentRuntime,
  JsonValue,
  Logger,
  SessionManager,
  SessionSnapshot,
  SystemLogManager,
  TraceEvent,
  TraceManager
} from "@ai-app-template/agent";
import {
  DEFAULT_SESSION_SETTINGS_USER_ID,
  SESSION_MAX_TURNS_LIMIT,
  THINKING_EFFORT_OPTIONS,
  USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS,
  USER_CONTEXT_HOOK_EVENT_OPTIONS,
  isWorkspaceSkillEnabled,
  normalizeThinkingEffort,
  normalizeCapabilityPacks,
  normalizeSettingsPermissionRules,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns,
  type SettingsPermissionToolOption,
  type WorkspaceSkillSettingRecord
} from "@ai-app-template/domain";
import type {
  SessionSettingsRecord,
  UserContextHookRecord
} from "@ai-app-template/domain";
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

const createSessionBodySchema = z.object({
  workingDirectory: z.string().optional(),
  model: z.string().optional(),
  thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
  userId: z.string().optional(),
  yoloMode: z.boolean().optional(),
  planModeEnabled: z.boolean().optional(),
  contextWindow: z.number().int().min(1000).optional(),
  maxTurns: z.number().int().min(1).optional(),
  enabledCapabilityPacks: z.array(z.string()).optional()
});

const updateSessionSettingsBodySchema = z
  .object({
    model: z.string().optional(),
    thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
    yoloMode: z.boolean().optional(),
    planModeEnabled: z.boolean().optional(),
    shellAllowPatterns: z.array(z.string()).optional(),
    shellDenyPatterns: z.array(z.string()).optional(),
    toolAllowList: z.array(z.string()).optional(),
    toolAskList: z.array(z.string()).optional(),
    toolDenyList: z.array(z.string()).optional(),
    enabledCapabilityPacks: z.array(z.string()).optional()
  })
  .refine(
    (value) =>
      typeof value.model === "string" ||
      typeof value.thinkingEffort === "string" ||
      typeof value.yoloMode === "boolean" ||
      typeof value.planModeEnabled === "boolean" ||
      Array.isArray(value.shellAllowPatterns) ||
      Array.isArray(value.shellDenyPatterns) ||
      Array.isArray(value.toolAllowList) ||
      Array.isArray(value.toolAskList) ||
      Array.isArray(value.toolDenyList) ||
      Array.isArray(value.enabledCapabilityPacks),
    {
      message: "At least one session settings field is required."
    }
  );

const updateUserSettingsBodySchema = z
  .object({
    workingDirectory: z.string().optional(),
    model: z.string().optional(),
    thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
    yoloMode: z.boolean().optional(),
    contextWindow: z.number().int().min(1000).optional(),
    maxTurns: z.number().int().min(1).optional(),
    shellAllowPatterns: z.array(z.string()).optional(),
    shellDenyPatterns: z.array(z.string()).optional(),
    toolAllowList: z.array(z.string()).optional(),
    toolAskList: z.array(z.string()).optional(),
    toolDenyList: z.array(z.string()).optional(),
    enabledCapabilityPacks: z.array(z.string()).optional(),
    workspaceSkillSettings: z
      .array(
        z.object({
          skillName: z.string().min(1),
          enabled: z.boolean()
        })
      )
      .optional(),
    userContextHooks: z
      .array(
        z.object({
          id: z.string().min(1),
          event: z.enum(USER_CONTEXT_HOOK_EVENT_OPTIONS),
          behavior: z.enum(USER_CONTEXT_HOOK_BEHAVIOR_OPTIONS).optional(),
          title: z.string(),
          content: z.string().min(1),
          enabled: z.boolean()
        })
      )
      .optional(),
    debugConversationView: z.boolean().optional(),
    userCustomPrompt: z.string().optional()
  })
  .refine(
    (value) =>
      typeof value.workingDirectory === "string" ||
      typeof value.model === "string" ||
      typeof value.thinkingEffort === "string" ||
      typeof value.yoloMode === "boolean" ||
      typeof value.contextWindow === "number" ||
      typeof value.maxTurns === "number" ||
      Array.isArray(value.shellAllowPatterns) ||
      Array.isArray(value.shellDenyPatterns) ||
      Array.isArray(value.toolAllowList) ||
      Array.isArray(value.toolAskList) ||
      Array.isArray(value.toolDenyList) ||
      Array.isArray(value.enabledCapabilityPacks) ||
      Array.isArray(value.workspaceSkillSettings) ||
      Array.isArray(value.userContextHooks) ||
      typeof value.debugConversationView === "boolean" ||
      typeof value.userCustomPrompt === "string",
    {
      message: "At least one settings field is required."
    }
  );

function toUserContextHookRecords(
  hooks: z.infer<typeof updateUserSettingsBodySchema>["userContextHooks"]
): UserContextHookRecord[] | undefined {
  if (!Array.isArray(hooks)) {
    return undefined;
  }

  return hooks.map((hook) => ({
    id: hook.id,
    event: hook.event,
    ...(hook.behavior ? { behavior: hook.behavior } : {}),
    title: hook.title,
    content: hook.content,
    enabled: hook.enabled
  }));
}

function toWorkspaceSkillSettingRecords(
  settings: z.infer<
    typeof updateUserSettingsBodySchema
  >["workspaceSkillSettings"]
): WorkspaceSkillSettingRecord[] | undefined {
  if (!Array.isArray(settings)) {
    return undefined;
  }

  return settings.map((setting) => ({
    skillName: setting.skillName,
    enabled: setting.enabled
  }));
}

function hasDuplicateMcpServerNames(
  servers: z.infer<typeof updateMcpServersBodySchema>["servers"]
): boolean {
  const seen = new Set<string>();
  for (const server of servers) {
    const name = server.name.trim();
    if (seen.has(name)) {
      return true;
    }
    seen.add(name);
  }
  return false;
}

const chooseDirectoryBodySchema = z.object({
  startDirectory: z.string().optional()
});

const mcpStringRecordSchema = z.record(z.string(), z.string());

const updateMcpServerSchema = z.discriminatedUnion("transport", [
  z.object({
    name: z.string().trim().min(1),
    transport: z.literal("stdio"),
    enabled: z.boolean().optional(),
    disabledTools: z.array(z.string()).optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    env: mcpStringRecordSchema.optional()
  }),
  z.object({
    name: z.string().trim().min(1),
    transport: z.literal("http"),
    enabled: z.boolean().optional(),
    disabledTools: z.array(z.string()).optional(),
    url: z.string().trim().url(),
    headers: mcpStringRecordSchema.optional()
  })
]);

const updateMcpServersBodySchema = z.object({
  servers: z.array(updateMcpServerSchema)
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

const executeSessionBodySchema = z.object({
  message: z.string().min(1),
  maxTurns: z.number().int().min(1).max(SESSION_MAX_TURNS_LIMIT).optional(),
  permissionReply: z.boolean().optional()
});

const workspaceFileChangeSchema = z.object({
  path: z.string().min(1),
  action: z.enum(["modify", "create", "delete"]),
  addedLineCount: z.number().int().min(0),
  removedLineCount: z.number().int().min(0),
  diff: z.string().min(1)
});

const workspaceFileChangeActionBodySchema = z.object({
  action: z.enum(["undo", "reapply"]),
  files: z.array(workspaceFileChangeSchema).min(1)
});

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

async function buildUserSettingsMcpPayload(workingDirectory: string) {
  const config = await readManageableWorkspaceMcpConfig(workingDirectory);
  const loadResult = await loadWorkspaceMcpTools(workingDirectory);

  try {
    return {
      workingDirectory,
      ...config,
      serverStatuses: loadResult.servers
    };
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
  action: "undo" | "reapply";
  files: Array<z.infer<typeof workspaceFileChangeSchema>>;
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
    const body = createSessionBodySchema.parse(await c.req.json());
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
    const body = updateMcpServersBodySchema.parse(await c.req.json());
    if (hasDuplicateMcpServerNames(body.servers)) {
      return c.json({ error: "MCP server names must be unique." }, 400);
    }

    const servers = body.servers.map((server) =>
      server.transport === "stdio"
        ? {
            name: server.name.trim(),
            transport: "stdio" as const,
            enabled: server.enabled ?? true,
            disabledTools: server.disabledTools ?? [],
            command: server.command.trim(),
            args: server.args ?? [],
            env: server.env ?? {}
          }
        : {
            name: server.name.trim(),
            transport: "http" as const,
            enabled: server.enabled ?? true,
            disabledTools: server.disabledTools ?? [],
            url: server.url.trim(),
            headers: server.headers ?? {}
          }
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
    const body = updateUserSettingsBodySchema.parse(await c.req.json());
    const requestedModel = resolveRequestedModel(dependencies, body.model);
    const workspaceSkillSettings = toWorkspaceSkillSettingRecords(
      body.workspaceSkillSettings
    );
    const userContextHooks = toUserContextHookRecords(body.userContextHooks);
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
      ...(workspaceSkillSettings ? { workspaceSkillSettings } : {}),
      ...(userContextHooks ? { userContextHooks } : {}),
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

  app.patch("/sessions/:sessionId/settings", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const body = updateSessionSettingsBodySchema.parse(await c.req.json());
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

    return c.json({
      items: result.matches.map((match) => ({
        path: match.path,
        name: match.name
      })),
      truncated: result.truncated
    });
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

    return c.json({
      items: result.matches.map((match) => ({
        name: match.name,
        description: match.description,
        relativePath: match.relativePath
      })),
      truncated: result.truncated
    });
  });

  app.get("/sessions/:sessionId/git-status", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = await dependencies.sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json(await getSessionWorkspaceGitStatus(session.workingDirectory));
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

    const body = workspaceFileChangeActionBodySchema.parse(await c.req.json());
    const patch = buildWorkspaceFileChangePatch(body);
    try {
      await applyUnifiedPatch({
        workingDirectory: session.workingDirectory,
        patch,
        allowWorkspaceEscape: false
      });

      return c.json({
        sessionId,
        action: body.action,
        files: body.files
      });
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

    const body = executeSessionBodySchema.parse(await c.req.json());
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

    const body = executeSessionBodySchema.parse(await c.req.json());
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
