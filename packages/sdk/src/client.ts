import {
  sessionFileChangeActionResultSchema,
  sessionWorkspaceGitStatusSchema,
  userSettingsMcpPayloadSchema,
  workspaceFileSearchResultSchema,
  workspaceSkillSearchResultSchema
} from "@ai-app-template/agent/contracts/workspace-api";
import type {
  RunSessionResult,
  RunStreamEvent,
  SessionFileChangeActionResult,
  SessionForkTarget,
  SessionRewriteTarget,
  SessionSnapshot,
  SessionWorkspaceGitStatus,
  TraceRecord,
  UpdateUserSettingsMcpPayload,
  UserSettingsMcpPayload,
  WorkspaceFileChangeSummary,
  WorkspaceFileSearchResult,
  WorkspaceSkillSearchResult
} from "@ai-app-template/agent";
import type {
  CreateSessionPayload,
  SettingsPermissionToolOption,
  RoutineRecord,
  SessionSettingsRecord,
  UpdateSessionSettingsPayload,
  UpdateUserSettingsPayload
} from "@ai-app-template/domain";
export type {
  CreateSessionPayload,
  UpdateSessionSettingsPayload,
  UpdateUserSettingsPayload
} from "@ai-app-template/domain";

export interface ApiClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

interface ApiErrorPayload {
  error: {
    message: string;
    name?: string;
    code?: string;
    requestId?: string;
    status?: number;
    details?: unknown;
  };
}

export interface SessionSummary {
  sessionId: string;
  parentSessionId?: string | null;
  parentRelationKind?: SessionSnapshot["parentRelationKind"];
  parentSessionTaskKind?: SessionSnapshot["parentSessionTaskKind"];
  updatedAt: string;
  workingDirectory: string;
  yoloMode: boolean;
  model: string;
  loopState: SessionSnapshot["sessionState"]["loopState"];
  turnCount: number;
  pendingToolCallIds: string[];
  interruptRequested: boolean;
  pendingPermission: boolean;
  pendingConfirmation: boolean;
  pendingUserQuestion: boolean;
  pendingBackgroundNotificationCount: number;
  activeBackgroundTaskCount: number;
  status: SessionSnapshot["context"]["status"];
  firstUserMessage: string | null;
  lastUserMessage: string | null;
}

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: string;
  description: string;
  configured: boolean;
  baseURL: string;
  supportsThinking: boolean;
  thinkingEfforts: string[];
  unavailableReason: string | null;
}

export interface ListModelsResult {
  defaultModel: string | null;
  models: ModelCatalogEntry[];
}

export interface InterruptSessionResult {
  sessionId: string;
  accepted: true;
  mode?: "interrupt_requested" | "force_stopped";
  session: SessionSnapshot;
}

export interface CreateSessionForkPayload {
  checkpointId?: string;
  assistantMessageId?: string;
}

export interface RecoverRewriteTargetPayload {
  checkpointId: string;
  userMessageId: string;
}

export interface SessionHistoryTargetsPayload {
  sessionId: string;
  forkTargets: SessionForkTarget[];
  rewriteTarget: SessionRewriteTarget | null;
}

export interface UserSettingsPayload {
  settings: SessionSettingsRecord;
  permissionTools: SettingsPermissionToolOption[];
}

export interface UserSettingsSkillItem {
  name: string;
  description: string;
  relativePath: string;
  enabled: boolean;
}

export interface UserSettingsSkillDiagnostic {
  relativePath: string;
  reason: string;
  message: string;
}

export interface UserSettingsSkillsPayload {
  workingDirectory: string;
  skills: UserSettingsSkillItem[];
  diagnostics: UserSettingsSkillDiagnostic[];
}

export interface ChooseDirectoryInput {
  startDirectory?: string;
}

export interface ChooseDirectoryResult {
  path: string | null;
  canceled: boolean;
}

export interface ListSessionRoutinesResult {
  sessionId: string;
  startDate: string;
  endDate: string;
  routines: RoutineRecord[];
}

export interface ResetSessionRoutinesResult {
  sessionId: string;
  resetCount: number;
}

export interface StreamSessionExecutionInput {
  sessionId: string;
  message: string;
  maxTurns?: number;
  permissionReply?: boolean;
  signal?: AbortSignal;
  onEvent: (event: RunStreamEvent) => void | Promise<void>;
}

export interface SessionFileChangeActionInput {
  sessionId: string;
  action: "undo" | "reapply";
  files: WorkspaceFileChangeSummary[];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function toJsonHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return (
    isPlainObject(value) &&
    isPlainObject(value.error) &&
    typeof value.error.message === "string"
  );
}

function formatApiErrorMessage(
  payload: ApiErrorPayload,
  fallbackStatus: number
): string {
  const status = payload.error.status ?? fallbackStatus;
  const lines = [`HTTP ${status}: ${payload.error.message}`];
  if (payload.error.name && payload.error.name !== "Error") {
    lines.push(`name: ${payload.error.name}`);
  }
  if (payload.error.code) {
    lines.push(`code: ${payload.error.code}`);
  }
  if (payload.error.requestId) {
    lines.push(`requestId: ${payload.error.requestId}`);
  }
  if (typeof payload.error.details !== "undefined") {
    lines.push(`details: ${JSON.stringify(payload.error.details, null, 2)}`);
  }
  return lines.join("\n");
}

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) {
    return response;
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (text && contentType.includes("application/json")) {
    try {
      const payload = JSON.parse(text) as unknown;
      if (isApiErrorPayload(payload)) {
        throw new Error(formatApiErrorMessage(payload, response.status));
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
    }
  }

  throw new Error(text || `Request failed with status ${response.status}`);
}

function buildUrl(baseUrl: string, pathname: string): string {
  return `${trimTrailingSlash(baseUrl)}${pathname}`;
}

function appendCacheBust(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_ts=${Date.now()}`;
}

function getFirstUserMessage(session: SessionSnapshot): string | null {
  if (session.context.firstUserMessage) {
    return session.context.firstUserMessage;
  }

  const firstUserBlock = session.messages.find(
    (
      block
    ): block is Extract<
      SessionSnapshot["messages"][number],
      { kind: "user" }
    > => block.kind === "user" && block.content.trim().length > 0
  );

  return firstUserBlock?.content ?? null;
}

function toSessionSummary(session: SessionSnapshot): SessionSummary {
  return {
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId ?? null,
    parentRelationKind: session.parentRelationKind ?? null,
    parentSessionTaskKind: session.parentSessionTaskKind ?? null,
    updatedAt: session.updatedAt,
    workingDirectory: session.workingDirectory,
    yoloMode: session.context.yoloMode,
    model: session.model,
    loopState: session.sessionState.loopState,
    turnCount: session.sessionState.turnCount,
    pendingToolCallIds: session.sessionState.pendingToolCallIds,
    interruptRequested: session.sessionState.interruptRequested,
    pendingPermission: Boolean(session.context.pendingPermissionRequest),
    pendingConfirmation: Boolean(session.context.pendingConfirmationPayload),
    pendingUserQuestion: Boolean(session.context.pendingUserQuestionPayload),
    pendingBackgroundNotificationCount:
      session.context.pendingBackgroundNotifications.length,
    activeBackgroundTaskCount: session.context.activeBackgroundTaskCount,
    status: session.context.status,
    firstUserMessage: getFirstUserMessage(session),
    lastUserMessage: session.context.lastUserMessage
  };
}

function isProgressiveTextEvent(event: RunStreamEvent): boolean {
  return event.kind === "assistant_text" || event.kind === "thinking";
}

async function yieldForBrowserPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function readEventStream(
  response: Response,
  onEvent: (event: RunStreamEvent) => void | Promise<void>
): Promise<void> {
  const body = response.body;
  if (!body) {
    throw new Error("Missing response body for event stream.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const normalized = buffer.replace(/\r\n/g, "\n");
    const chunks = normalized.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (!line || line.startsWith(":")) {
          continue;
        }

        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }

      if (eventName === "message" || dataLines.length === 0) {
        continue;
      }

      const event = JSON.parse(dataLines.join("\n")) as RunStreamEvent;
      await onEvent(event);
      if (isProgressiveTextEvent(event)) {
        await yieldForBrowserPaint();
      }
    }
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ApiClientConfig) {
    this.baseUrl = trimTrailingSlash(config.baseUrl);
    this.fetchImpl =
      config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async listSessions(): Promise<SessionSnapshot[]> {
    const response = await this.fetchImpl(
      appendCacheBust(buildUrl(this.baseUrl, "/sessions")),
      {
        cache: "no-store"
      }
    );
    const payload = (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      sessions: SessionSnapshot[];
    };
    return payload.sessions;
  }

  async searchSessions(query: string): Promise<SessionSnapshot[]> {
    const searchParams = new URLSearchParams();
    searchParams.set("q", query);
    const response = await this.fetchImpl(
      appendCacheBust(
        buildUrl(this.baseUrl, `/sessions/search?${searchParams.toString()}`)
      ),
      {
        cache: "no-store"
      }
    );
    const payload = (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      sessions: SessionSnapshot[];
    };
    return payload.sessions;
  }

  async listSessionSummaries(): Promise<SessionSummary[]> {
    const sessions = await this.listSessions();
    return sessions.map(toSessionSummary);
  }

  async listModels(): Promise<ListModelsResult> {
    const response = await this.fetchImpl(
      appendCacheBust(buildUrl(this.baseUrl, "/models")),
      {
        cache: "no-store"
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as ListModelsResult;
  }

  async createSession(
    input: CreateSessionPayload = {}
  ): Promise<SessionSnapshot> {
    const response = await this.fetchImpl(buildUrl(this.baseUrl, "/sessions"), {
      method: "POST",
      headers: toJsonHeaders(),
      body: JSON.stringify(input)
    });
    const payload = (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      session: SessionSnapshot;
    };
    return payload.session;
  }

  async getSession(sessionId: string): Promise<SessionSnapshot> {
    const response = await this.fetchImpl(
      appendCacheBust(buildUrl(this.baseUrl, `/sessions/${sessionId}`)),
      {
        cache: "no-store"
      }
    );
    const payload = (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      session: SessionSnapshot;
    };
    return payload.session;
  }

  async listSessionForkTargets(
    sessionId: string
  ): Promise<SessionHistoryTargetsPayload> {
    const response = await this.fetchImpl(
      appendCacheBust(
        buildUrl(this.baseUrl, `/sessions/${sessionId}/fork-targets`)
      ),
      {
        cache: "no-store"
      }
    );
    await ensureOk(response);
    return (await response.json()) as SessionHistoryTargetsPayload;
  }

  async createSessionFork(
    sessionId: string,
    payload: CreateSessionForkPayload
  ): Promise<SessionSnapshot> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/forks`),
      {
        method: "POST",
        headers: toJsonHeaders(),
        body: JSON.stringify(payload)
      }
    );
    await ensureOk(response);
    const result = (await response.json()) as {
      session: SessionSnapshot;
    };
    return result.session;
  }

  async recoverRewriteTarget(
    sessionId: string,
    payload: RecoverRewriteTargetPayload
  ): Promise<{
    session: SessionSnapshot;
    traceRecords: TraceRecord[];
    forkTargets: SessionForkTarget[];
    rewriteTarget: SessionRewriteTarget | null;
  }> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/rewrite-target/recover`),
      {
        method: "POST",
        headers: toJsonHeaders(),
        body: JSON.stringify(payload)
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      session: SessionSnapshot;
      traceRecords: TraceRecord[];
      forkTargets: SessionForkTarget[];
      rewriteTarget: SessionRewriteTarget | null;
    };
  }

  async updateSessionSettings(
    sessionId: string,
    input: UpdateSessionSettingsPayload
  ): Promise<SessionSnapshot> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/settings`),
      {
        method: "PATCH",
        headers: toJsonHeaders(),
        body: JSON.stringify(input)
      }
    );
    const payload = (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      session: SessionSnapshot;
    };
    return payload.session;
  }

  async getUserSettingsPayload(userId: string): Promise<UserSettingsPayload> {
    const response = await this.fetchImpl(
      appendCacheBust(buildUrl(this.baseUrl, `/users/${userId}/settings`)),
      {
        cache: "no-store"
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as UserSettingsPayload;
  }

  async getUserSettings(userId: string): Promise<SessionSettingsRecord> {
    const payload = await this.getUserSettingsPayload(userId);
    return payload.settings;
  }

  async chooseDirectory(
    input: ChooseDirectoryInput = {}
  ): Promise<ChooseDirectoryResult> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, "/directory-picker"),
      {
        method: "POST",
        headers: toJsonHeaders(),
        body: JSON.stringify(input)
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as ChooseDirectoryResult;
  }

  async getUserSettingsMcp(userId: string): Promise<UserSettingsMcpPayload> {
    const response = await this.fetchImpl(
      appendCacheBust(buildUrl(this.baseUrl, `/users/${userId}/settings/mcp`)),
      {
        cache: "no-store"
      }
    );
    return userSettingsMcpPayloadSchema.parse(
      await ensureOk(response).then((result) => result.json())
    );
  }

  async getUserSettingsSkills(
    userId: string
  ): Promise<UserSettingsSkillsPayload> {
    const response = await this.fetchImpl(
      appendCacheBust(
        buildUrl(this.baseUrl, `/users/${userId}/settings/skills`)
      ),
      {
        cache: "no-store"
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as UserSettingsSkillsPayload;
  }

  async updateUserSettingsMcp(
    userId: string,
    input: UpdateUserSettingsMcpPayload
  ): Promise<UserSettingsMcpPayload> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/users/${userId}/settings/mcp`),
      {
        method: "PUT",
        headers: toJsonHeaders(),
        body: JSON.stringify(input)
      }
    );
    return userSettingsMcpPayloadSchema.parse(
      await ensureOk(response).then((result) => result.json())
    );
  }

  async searchSessionWorkspaceFiles(
    sessionId: string,
    input: { query: string; limit?: number }
  ): Promise<WorkspaceFileSearchResult> {
    const searchParams = new URLSearchParams({
      q: input.query
    });
    if (typeof input.limit === "number") {
      searchParams.set("limit", String(input.limit));
    }

    const response = await this.fetchImpl(
      appendCacheBust(
        buildUrl(
          this.baseUrl,
          `/sessions/${sessionId}/workspace-files/search?${searchParams.toString()}`
        )
      ),
      {
        cache: "no-store"
      }
    );

    return workspaceFileSearchResultSchema.parse(
      await ensureOk(response).then((result) => result.json())
    );
  }

  async searchSessionSkills(
    sessionId: string,
    input: { query: string; limit?: number }
  ): Promise<WorkspaceSkillSearchResult> {
    const searchParams = new URLSearchParams({
      q: input.query
    });
    if (typeof input.limit === "number") {
      searchParams.set("limit", String(input.limit));
    }

    const response = await this.fetchImpl(
      appendCacheBust(
        buildUrl(
          this.baseUrl,
          `/sessions/${sessionId}/skills/search?${searchParams.toString()}`
        )
      ),
      {
        cache: "no-store"
      }
    );

    return workspaceSkillSearchResultSchema.parse(
      await ensureOk(response).then((result) => result.json())
    );
  }

  async getSessionWorkspaceGitStatus(
    sessionId: string
  ): Promise<SessionWorkspaceGitStatus> {
    const response = await this.fetchImpl(
      appendCacheBust(
        buildUrl(this.baseUrl, `/sessions/${sessionId}/git-status`)
      ),
      {
        cache: "no-store"
      }
    );

    return sessionWorkspaceGitStatusSchema.parse(
      await ensureOk(response).then((result) => result.json())
    );
  }

  async updateUserSettingsPayload(
    userId: string,
    input: UpdateUserSettingsPayload
  ): Promise<UserSettingsPayload> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/users/${userId}/settings`),
      {
        method: "PATCH",
        headers: toJsonHeaders(),
        body: JSON.stringify(input)
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as UserSettingsPayload;
  }

  async updateUserSettings(
    userId: string,
    input: UpdateUserSettingsPayload
  ): Promise<SessionSettingsRecord> {
    const payload = await this.updateUserSettingsPayload(userId, input);
    return payload.settings;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}`),
      {
        method: "DELETE"
      }
    );
    await ensureOk(response);
  }

  async clearSessionHistory(): Promise<void> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, "/sessions/history"),
      {
        method: "DELETE"
      }
    );
    await ensureOk(response);
  }

  async interruptSessionExecution(
    sessionId: string
  ): Promise<InterruptSessionResult> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/interrupt`),
      {
        method: "POST"
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as InterruptSessionResult;
  }

  async forceStopSessionExecution(
    sessionId: string
  ): Promise<InterruptSessionResult> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/force-stop`),
      {
        method: "POST"
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as InterruptSessionResult;
  }

  async executeSession(
    sessionId: string,
    message: string,
    maxTurns?: number,
    permissionReply?: boolean
  ): Promise<RunSessionResult> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/execute`),
      {
        method: "POST",
        headers: toJsonHeaders(),
        body: JSON.stringify({
          message,
          ...(typeof maxTurns === "number" ? { maxTurns } : {}),
          ...(typeof permissionReply === "boolean" ? { permissionReply } : {})
        })
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as RunSessionResult;
  }

  async streamSessionExecution(
    input: StreamSessionExecutionInput
  ): Promise<void> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${input.sessionId}/execute/stream`),
      {
        method: "POST",
        headers: toJsonHeaders(),
        body: JSON.stringify({
          message: input.message,
          ...(typeof input.maxTurns === "number"
            ? { maxTurns: input.maxTurns }
            : {}),
          ...(typeof input.permissionReply === "boolean"
            ? { permissionReply: input.permissionReply }
            : {})
        }),
        ...(input.signal ? { signal: input.signal } : {})
      }
    );

    await readEventStream(await ensureOk(response), input.onEvent);
  }

  async applySessionFileChangeAction(
    input: SessionFileChangeActionInput
  ): Promise<SessionFileChangeActionResult> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${input.sessionId}/file-changes`),
      {
        method: "POST",
        headers: toJsonHeaders(),
        body: JSON.stringify({
          action: input.action,
          files: input.files
        })
      }
    );
    return sessionFileChangeActionResultSchema.parse(
      await ensureOk(response).then((result) => result.json())
    );
  }

  async getSessionTrace(sessionId: string): Promise<TraceRecord[]> {
    const response = await this.fetchImpl(
      appendCacheBust(buildUrl(this.baseUrl, `/sessions/${sessionId}/trace`)),
      {
        cache: "no-store"
      }
    );
    const payload = (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      sessionId: string;
      events: TraceRecord[];
    };
    return payload.events;
  }

  async listSessionRoutines(
    sessionId: string,
    input: { startDate: string; endDate: string }
  ): Promise<ListSessionRoutinesResult> {
    const searchParams = new URLSearchParams({
      startDate: input.startDate,
      endDate: input.endDate
    });
    const response = await this.fetchImpl(
      appendCacheBust(
        buildUrl(
          this.baseUrl,
          `/sessions/${sessionId}/routines?${searchParams.toString()}`
        )
      ),
      {
        cache: "no-store"
      }
    );
    return (await ensureOk(response).then((result) =>
      result.json()
    )) as ListSessionRoutinesResult;
  }

  async resetSessionRoutines(
    sessionId: string
  ): Promise<ResetSessionRoutinesResult> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/routines/reset`),
      {
        method: "POST"
      }
    );

    return (await ensureOk(response).then((result) =>
      result.json()
    )) as ResetSessionRoutinesResult;
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}

export { toSessionSummary };
