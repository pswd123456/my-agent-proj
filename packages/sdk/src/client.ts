import type {
  RunSessionResult,
  RunStreamEvent,
  SessionSnapshot,
  TraceRecord
} from "@ai-app-template/agent";
import type { RoutineRecord } from "@ai-app-template/domain";

export interface ApiClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: string;
  workingDirectory: string;
  model: string;
  loopState: SessionSnapshot["sessionState"]["loopState"];
  turnCount: number;
  pendingToolCallIds: string[];
  pendingConfirmation: boolean;
  status: SessionSnapshot["context"]["status"];
  lastUserMessage: string | null;
}

export interface CreateSessionPayload {
  workingDirectory?: string;
  userId?: string;
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
  signal?: AbortSignal;
  onEvent: (event: RunStreamEvent) => void | Promise<void>;
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

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) {
    return response;
  }

  const text = await response.text();
  throw new Error(text || `Request failed with status ${response.status}`);
}

function buildUrl(baseUrl: string, pathname: string): string {
  return `${trimTrailingSlash(baseUrl)}${pathname}`;
}

function toSessionSummary(session: SessionSnapshot): SessionSummary {
  return {
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
    workingDirectory: session.workingDirectory,
    model: session.model,
    loopState: session.sessionState.loopState,
    turnCount: session.sessionState.turnCount,
    pendingToolCallIds: session.sessionState.pendingToolCallIds,
    pendingConfirmation: Boolean(session.context.pendingConfirmationPayload),
    status: session.context.status,
    lastUserMessage: session.context.lastUserMessage
  };
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

      await onEvent(JSON.parse(dataLines.join("\n")) as RunStreamEvent);
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
    const response = await this.fetchImpl(buildUrl(this.baseUrl, "/sessions"));
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
      buildUrl(this.baseUrl, `/sessions/${sessionId}`)
    );
    const payload = (await ensureOk(response).then((result) =>
      result.json()
    )) as {
      session: SessionSnapshot;
    };
    return payload.session;
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

  async executeSession(
    sessionId: string,
    message: string,
    maxTurns?: number
  ): Promise<RunSessionResult> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/execute`),
      {
        method: "POST",
        headers: toJsonHeaders(),
        body: JSON.stringify({
          message,
          ...(typeof maxTurns === "number" ? { maxTurns } : {})
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
            : {})
        }),
        ...(input.signal ? { signal: input.signal } : {})
      }
    );

    await readEventStream(await ensureOk(response), input.onEvent);
  }

  async getSessionTrace(sessionId: string): Promise<TraceRecord[]> {
    const response = await this.fetchImpl(
      buildUrl(this.baseUrl, `/sessions/${sessionId}/trace`)
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
      buildUrl(
        this.baseUrl,
        `/sessions/${sessionId}/routines?${searchParams.toString()}`
      )
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
