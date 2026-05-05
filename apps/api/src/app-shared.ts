import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  applyUnifiedPatch,
  createRunErrorEvent,
  createRunTraceEvent,
  discoverWorkspaceSkills,
  findDuplicateWorkspaceMcpServerNames,
  invertUnifiedPatch,
  listSettingsPermissionToolOptions,
  loadWorkspaceMcpTools,
  ModelUnavailableError,
  parseUnifiedPatch,
  readManageableWorkspaceChannelConfig,
  readManageableWorkspaceMcpConfig,
  type ModelCatalogEntry,
  type RunEventSink,
  type RunSessionResult,
  type SessionFileChangeActionRequest,
  type UserSettingsChannelsPayload,
  type UserSettingsMcpPayload,
  UnsupportedModelError,
  userSettingsChannelsPayloadSchema,
  userSettingsMcpPayloadSchema
} from "@ai-app-template/agent";
import type {
  JsonValue,
  Logger,
  TraceEvent,
  TraceManager
} from "@ai-app-template/agent";
import {
  isWorkspaceSkillEnabled,
  normalizeThinkingEffort,
  sanitizeContextWindow,
  sanitizeSessionMaxTurns,
  type SettingsPermissionToolOption
} from "@ai-app-template/domain";
import type { InboxBindingRepository } from "@ai-app-template/db";
import type {
  SessionSettingsRecord,
  WorkspaceSkillSettingRecord
} from "@ai-app-template/domain";

import type { ApiAppDependencies } from "./app-context.js";

export const chooseDirectoryBodySchema = z.object({
  startDirectory: z.string().optional()
});

export const searchWorkspaceQuerySchema = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export const recoverSessionBodySchema = z.object({
  snapshot: z.unknown()
});

export const listRoutinesQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const systemLogsQuerySchema = z.object({
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

export function hasDuplicateMcpServerNames(
  servers: Parameters<typeof findDuplicateWorkspaceMcpServerNames>[0]
): boolean {
  return findDuplicateWorkspaceMcpServerNames(servers).length > 0;
}

export function buildSettingsPermissionMetadata(
  dependencies: ApiAppDependencies
): SettingsPermissionToolOption[] {
  return listSettingsPermissionToolOptions({
    workingDirectory: dependencies.buildWorkingDirectory()
  });
}

export async function buildUserSettingsMcpPayload(
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

export async function buildUserSettingsChannelsPayload(
  workingDirectory: string,
  inboxBindingRepository?: InboxBindingRepository
): Promise<UserSettingsChannelsPayload> {
  const config = await readManageableWorkspaceChannelConfig(workingDirectory);
  const telegramBindings = inboxBindingRepository
    ? await inboxBindingRepository.listByChannel("telegram")
    : [];

  return userSettingsChannelsPayloadSchema.parse({
    workingDirectory,
    ...config,
    telegramBindings: telegramBindings.map((binding) => ({
      channel: binding.channel,
      externalChatId: binding.externalChatId,
      activeSessionId: binding.activeSessionId,
      responseOutputMode: binding.settings.responseOutputMode,
      lastUpdateId: binding.lastUpdateId,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt
    }))
  });
}

export async function buildUserSettingsSkillsPayload(
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

export function resolveDefaultModel(
  dependencies: ApiAppDependencies
): string | undefined {
  return (
    dependencies.modelService?.getDefaultModel() ?? dependencies.defaultModel
  );
}

export function buildModelCatalog(dependencies: ApiAppDependencies): {
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

export function resolveRequestedModel(
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

export function toCreateSessionInput(input: {
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

export function encodeSseEvent<T extends { kind: string }>(
  event: T
): Uint8Array {
  const payload = JSON.stringify(event);
  return new TextEncoder().encode(`event: ${event.kind}\ndata: ${payload}\n\n`);
}

export function enqueueRunErrorEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: {
    sessionId: string;
    session: Awaited<
      ReturnType<ApiAppDependencies["sessionManager"]["getSession"]>
    >;
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

export function getRequestId(c: {
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

export function buildErrorPayload(error: unknown, requestId: string) {
  const details = getErrorDetails(error);
  const status = getErrorStatus(error) as 400 | 500;
  const code = getErrorCode(error);

  return {
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
}

export async function logApiEvent(input: {
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

export async function emitPreRunTraceEvent(input: {
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

export function buildWorkspaceFileChangePatch(input: {
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

export async function applySessionWorkspaceFileChange(input: {
  workingDirectory: string;
  request: SessionFileChangeActionRequest;
}) {
  const patch = buildWorkspaceFileChangePatch(input.request);
  await applyUnifiedPatch({
    workingDirectory: input.workingDirectory,
    patch,
    allowWorkspaceEscape: false
  });
}
