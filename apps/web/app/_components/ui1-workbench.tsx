"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import {
  createApiClient,
  toSessionSummary,
  type RoutineRecord,
  type RunStreamEvent,
  type SessionSnapshot,
  type SessionSummary,
  type TraceRecord
} from "@ai-app-template/sdk";
import {
  buildWeekRange,
  collectToolRows,
  flattenTraceRecords,
  groupRoutinesByDate,
  mergeSessionSummary,
  parseDateString
} from "./ui1-workbench-state";

const apiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"
});

const inspectorTabs = [
  { id: "prompt", label: "Prompt" },
  { id: "thinking", label: "Thinking" },
  { id: "tools", label: "Tools" },
  { id: "trace", label: "Trace" }
] as const;

const DEFAULT_MAX_TURNS = 6;
const MAX_TURNS_LIMIT = 20;

type InspectorTabId = (typeof inspectorTabs)[number]["id"];

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDayLabel(value: string): string {
  return parseDateString(value).toLocaleDateString("zh-CN", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit"
  });
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function getStateTone(
  loopState: SessionSnapshot["sessionState"]["loopState"]
): string {
  if (loopState === "completed") {
    return "text-[var(--app-status-success)]";
  }

  if (loopState === "failed") {
    return "text-[var(--app-status-danger)]";
  }

  if (loopState === "waiting for tool result") {
    return "text-[var(--app-status-warning)]";
  }

  return "text-[var(--app-text-secondary)]";
}

function getBubbleClass(kind: "user" | "assistant"): string {
  if (kind === "user") {
    return "ml-auto max-w-[88%] rounded-[var(--app-radius-lg)] rounded-br-md border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-3 text-sm leading-7 text-[var(--app-text-primary)]";
  }

  return "max-w-[92%] rounded-[var(--app-radius-lg)] rounded-bl-md border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm leading-7 text-[var(--app-text-secondary)]";
}

function getDebugPreClass(surface: "muted" | "surface" = "muted"): string {
  const backgroundClass =
    surface === "surface"
      ? "bg-[var(--app-bg-surface)]"
      : "bg-[var(--app-bg-muted)]";

  return `mt-2 min-w-0 whitespace-pre-wrap rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] ${backgroundClass} p-3 text-xs leading-6 text-[var(--app-text-secondary)] [overflow-wrap:anywhere]`;
}

function getInspectorCardClass(extraClassName = ""): string {
  return `min-w-0 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-muted)] px-4 py-4 ${extraClassName}`.trim();
}

function sortSessionSummaries(snapshots: SessionSnapshot[]): SessionSummary[] {
  return snapshots
    .map(toSessionSummary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isReusableNewSession(session: SessionSnapshot): boolean {
  return (
    session.messages.length === 0 &&
    !session.context.lastUserMessage &&
    session.context.status === "waiting_for_user_input"
  );
}

function normalizeMaxTurns(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_MAX_TURNS;
  }

  return Math.min(MAX_TURNS_LIMIT, Math.max(1, parsed));
}

function getExecutionEventKey(event: RunStreamEvent): string {
  if (event.kind === "tool_call" || event.kind === "tool_result") {
    return `${event.kind}-${event.toolCallId}-${event.createdAt}`;
  }

  if (event.kind === "thinking") {
    return `${event.kind}-${event.signature}-${event.createdAt}`;
  }

  if (event.kind === "run_complete" || event.kind === "run_error") {
    return `${event.kind}-${event.createdAt}-${event.sessionId}`;
  }

  return `${event.kind}-${event.createdAt}`;
}

function renderUserMessageBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "user" }>
) {
  return (
    <div key={block.id} className={getBubbleClass("user")}>
      {block.content}
    </div>
  );
}

function renderExecutionEvent(event: RunStreamEvent) {
  if (event.kind === "assistant_text") {
    return (
      <div
        key={getExecutionEventKey(event)}
        className={getBubbleClass("assistant")}
      >
        {event.text}
      </div>
    );
  }

  if (event.kind === "thinking") {
    return (
      <article
        key={getExecutionEventKey(event)}
        className={getInspectorCardClass(
          "text-sm leading-7 text-[var(--app-text-muted)]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Thinking
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {event.text}
        </div>
      </article>
    );
  }

  if (event.kind === "tool_call") {
    return (
      <article
        key={getExecutionEventKey(event)}
        className={getInspectorCardClass()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              Tool Call
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              {event.toolName}
            </div>
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
          {stringify(event.input)}
        </pre>
      </article>
    );
  }

  if (event.kind === "tool_result") {
    return (
      <article
        key={getExecutionEventKey(event)}
        className={getInspectorCardClass()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              Tool Result
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              {event.toolName}
            </div>
          </div>
          <div
            className={`text-[0.72rem] ${
              event.isError
                ? "text-[var(--app-status-danger)]"
                : "text-[var(--app-status-success)]"
            }`}
          >
            {event.isError ? "failed" : "ok"}
          </div>
        </div>
        <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
          {event.displayText ?? event.output}
        </pre>
      </article>
    );
  }

  if (event.kind === "turn_start" || event.kind === "turn_end") {
    return (
      <div
        key={getExecutionEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] border border-[var(--app-border-subtle)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-text-primary)]">
          {event.kind === "turn_start"
            ? `Turn ${event.turnCount} started`
            : `Turn ${event.turnCount} ended`}
        </span>
        <span className="font-mono text-[var(--app-text-muted)]">
          {formatTimestamp(event.createdAt)}
        </span>
      </div>
    );
  }

  if (event.kind === "fallback") {
    return (
      <article
        key={getExecutionEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] border border-[var(--app-status-warning)]/40 bg-[var(--app-bg-muted)] px-4 py-4 text-sm leading-7 text-[var(--app-text-secondary)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Fallback
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3">{event.summary}</div>
      </article>
    );
  }

  if (event.kind === "run_error") {
    return (
      <article
        key={getExecutionEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[var(--app-bg-muted)] px-4 py-4 text-sm leading-7 text-[var(--app-status-danger)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em]">
            Run Error
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3">{event.error}</div>
      </article>
    );
  }

  if (event.kind === "response") {
    return (
      <div
        key={getExecutionEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] border border-[var(--app-border-subtle)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-text-primary)]">
          response / input {event.usage.inputTokens} / output{" "}
          {event.usage.outputTokens}
        </span>
        <span className="font-mono text-[var(--app-text-muted)]">
          {formatTimestamp(event.createdAt)}
        </span>
      </div>
    );
  }

  if (event.kind === "run_complete") {
    return (
      <div
        key={getExecutionEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] border border-[var(--app-status-success)]/40 px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-status-success)]">
          run complete / {event.status}
        </span>
        <span className="font-mono text-[var(--app-text-muted)]">
          {formatTimestamp(event.createdAt)}
        </span>
      </div>
    );
  }

  return null;
}

export function UI1Workbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId");
  const selectedSessionIdRef = useRef<string | null>(null);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [currentSession, setCurrentSession] = useState<SessionSnapshot | null>(
    null
  );
  const [traceRecords, setTraceRecords] = useState<TraceRecord[]>([]);
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [streamEvents, setStreamEvents] = useState<RunStreamEvent[]>([]);
  const [message, setMessage] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<{
    createdAt: string;
    text: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTabId>("prompt");
  const [loading, setLoading] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null
  );
  const [resettingRoutines, setResettingRoutines] = useState(false);
  const [maxTurns, setMaxTurns] = useState(String(DEFAULT_MAX_TURNS));
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setErrorText(null);

      try {
        let snapshots = await apiClient.listSessions();
        if (!snapshots.length) {
          const created = await apiClient.createSession();
          snapshots = [created];
        }

        if (cancelled) {
          return;
        }

        const summaries = sortSessionSummaries(snapshots);
        const fallbackSessionId = summaries[0]?.sessionId ?? null;
        const nextSessionId = summaries.some(
          (item) => item.sessionId === requestedSessionId
        )
          ? requestedSessionId
          : fallbackSessionId;

        setSessions(summaries);
        setSelectedSessionId(nextSessionId);
        if (nextSessionId) {
          router.replace(`/?sessionId=${nextSessionId}`, { scroll: false });
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [requestedSessionId, router]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    let cancelled = false;

    async function hydrateSession(sessionId: string) {
      setLoadingSession(true);
      setErrorText(null);

      try {
        const session = await apiClient.getSession(sessionId);
        const week = buildWeekRange(session.context.currentDateContext);
        const [trace, routinesResult] = await Promise.all([
          apiClient.getSessionTrace(sessionId),
          apiClient.listSessionRoutines(sessionId, {
            startDate: week.startDate,
            endDate: week.endDate
          })
        ]);

        if (cancelled) {
          return;
        }

        setCurrentSession(session);
        setTraceRecords(trace);
        setRoutines(routinesResult.routines);
        setSessions((current) =>
          mergeSessionSummary(current, session, toSessionSummary)
        );
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setLoadingSession(false);
        }
      }
    }

    void hydrateSession(selectedSessionId);

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  async function refreshSelectedSession(sessionId: string) {
    const session = await apiClient.getSession(sessionId);
    const week = buildWeekRange(session.context.currentDateContext);
    const [trace, routinesResult] = await Promise.all([
      apiClient.getSessionTrace(sessionId),
      apiClient.listSessionRoutines(sessionId, {
        startDate: week.startDate,
        endDate: week.endDate
      })
    ]);

    setCurrentSession(session);
    setTraceRecords(trace);
    setRoutines(routinesResult.routines);
    setSessions((current) =>
      mergeSessionSummary(current, session, toSessionSummary)
    );
    setStreamEvents([]);
  }

  async function handleCreateSession() {
    try {
      setErrorText(null);
      const snapshots = await apiClient.listSessions();
      const reusable = [...snapshots]
        .filter(isReusableNewSession)
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt)
        )[0];

      if (reusable) {
        setSessions(sortSessionSummaries(snapshots));
        setSelectedSessionId(reusable.sessionId);
        setCurrentSession(reusable);
        setTraceRecords([]);
        setRoutines([]);
        setStreamEvents([]);
        router.replace(`/?sessionId=${reusable.sessionId}`, { scroll: false });
        setSidebarOpen(false);
        return;
      }

      const session = await apiClient.createSession();
      setSessions((current) =>
        mergeSessionSummary(current, session, toSessionSummary)
      );
      setSelectedSessionId(session.sessionId);
      setCurrentSession(session);
      setTraceRecords([]);
      setRoutines([]);
      setStreamEvents([]);
      router.replace(`/?sessionId=${session.sessionId}`, { scroll: false });
      setSidebarOpen(false);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    setStreamEvents([]);
    router.replace(`/?sessionId=${sessionId}`, { scroll: false });
    setSidebarOpen(false);
  }

  async function handleDeleteSession(sessionId: string) {
    const confirmed = window.confirm(
      "删除后该会话和对应 trace 将不可恢复，确认继续吗？"
    );
    if (!confirmed) {
      return;
    }

    setDeletingSessionId(sessionId);
    setErrorText(null);

    try {
      await apiClient.deleteSession(sessionId);
      const remaining = sessions.filter(
        (session) => session.sessionId !== sessionId
      );
      setSessions(remaining);

      if (selectedSessionId !== sessionId) {
        return;
      }

      const nextSessionId = remaining[0]?.sessionId ?? null;
      setCurrentSession(null);
      setTraceRecords([]);
      setRoutines([]);
      setStreamEvents([]);

      if (nextSessionId) {
        setSelectedSessionId(nextSessionId);
        router.replace(`/?sessionId=${nextSessionId}`, { scroll: false });
        return;
      }

      const newSession = await apiClient.createSession();
      setSessions([toSessionSummary(newSession)]);
      setSelectedSessionId(newSession.sessionId);
      setCurrentSession(newSession);
      router.replace(`/?sessionId=${newSession.sessionId}`, { scroll: false });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSession || !message.trim() || submitting) {
      return;
    }

    const nextMessage = message.trim();
    const sessionId = currentSession.sessionId;
    const nextMaxTurns = normalizeMaxTurns(maxTurns);

    setMaxTurns(String(nextMaxTurns));
    setPendingUserMessage({
      createdAt: new Date().toISOString(),
      text: nextMessage
    });
    setMessage("");
    setStreamEvents([]);
    setSubmitting(true);
    setActiveTab("prompt");
    setErrorText(null);

    try {
      const isActiveStreamSession = () =>
        selectedSessionIdRef.current === sessionId;

      await apiClient.streamSessionExecution({
        sessionId,
        message: nextMessage,
        maxTurns: nextMaxTurns,
        async onEvent(runEvent: RunStreamEvent) {
          const isActiveSession = isActiveStreamSession();

          if (isActiveSession) {
            setStreamEvents((current) => [...current, runEvent]);
          }

          if (
            runEvent.kind === "run_complete" ||
            runEvent.kind === "run_error"
          ) {
            const nextSession = runEvent.session;
            if (nextSession) {
              setSessions((current) =>
                mergeSessionSummary(current, nextSession, toSessionSummary)
              );
              if (isActiveSession) {
                setCurrentSession(nextSession);
              }
            }
          }
        }
      });

      if (isActiveStreamSession()) {
        await refreshSelectedSession(sessionId);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
      setPendingUserMessage(null);
    }
  }

  async function handleResetAllRoutines() {
    if (!currentSession || resettingRoutines) {
      return;
    }

    const confirmed = window.confirm(
      "这会清空当前用户的全部日程记录，确认继续吗？"
    );
    if (!confirmed) {
      return;
    }

    setResettingRoutines(true);
    setErrorText(null);

    try {
      await apiClient.resetSessionRoutines(currentSession.sessionId);
      await refreshSelectedSession(currentSession.sessionId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setResettingRoutines(false);
    }
  }

  const historyEvents = flattenTraceRecords(traceRecords);
  const inspectorEvents = streamEvents.length ? streamEvents : historyEvents;
  const latestPromptEvent = [...inspectorEvents]
    .reverse()
    .find((event) => event.kind === "prompt");
  const thinkingEvents = inspectorEvents.filter(
    (event) => event.kind === "thinking"
  );
  const toolRows = collectToolRows(inspectorEvents);
  const groupedRoutines = groupRoutinesByDate(routines);
  const weekDates = currentSession
    ? buildWeekRange(currentSession.context.currentDateContext).dates
    : [];
  const timelineEntries = [
    ...(currentSession?.messages
      .filter((block) => block.kind === "user")
      .map((block) => ({
        createdAt: block.createdAt,
        key: `message-${block.id}`,
        sortOrder: 0,
        node: renderUserMessageBlock(block)
      })) ?? []),
    ...(pendingUserMessage
      ? [
          {
            createdAt: pendingUserMessage.createdAt,
            key: `pending-user-${pendingUserMessage.createdAt}`,
            sortOrder: 0,
            node: (
              <div
                key={`pending-user-${pendingUserMessage.createdAt}`}
                className={getBubbleClass("user")}
              >
                {pendingUserMessage.text}
              </div>
            )
          }
        ]
      : []),
    ...[...historyEvents, ...streamEvents]
      .filter((event) => event.kind !== "prompt" && event.kind !== "response")
      .map((event) => ({
        createdAt: event.createdAt,
        key: `event-${getExecutionEventKey(event)}`,
        sortOrder:
          event.kind === "turn_start"
            ? -1
            : event.kind === "turn_end" || event.kind === "run_complete"
              ? 1
              : 0,
        node: renderExecutionEvent(event)
      }))
  ].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return (
        left.sortOrder - right.sortOrder || left.key.localeCompare(right.key)
      );
    }

    return left.createdAt.localeCompare(right.createdAt);
  });

  return (
    <main className="min-h-screen bg-[var(--app-bg-canvas)] text-[var(--app-text-primary)]">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="关闭会话侧边栏遮罩"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/45"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[320px] max-w-[86vw] transition duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col border-r border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] shadow-[var(--app-shadow-lg)]">
          <div className="flex items-center justify-between border-b border-[var(--app-border-subtle)] px-4 py-4">
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                Sessions
              </div>
              <div className="mt-2 text-base font-semibold text-[var(--app-text-primary)]">
                会话侧边栏
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-xs text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
            >
              收起
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => void handleCreateSession()}
                className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)]"
              >
                创建新会话
              </button>
            </div>

            <div className="mt-5 grid gap-3">
              {sessions.map((session) => {
                const isActive = session.sessionId === selectedSessionId;
                const isDeleting = deletingSessionId === session.sessionId;

                return (
                  <article
                    key={session.sessionId}
                    className={`rounded-[var(--app-radius-lg)] border px-3 py-3 transition ${
                      isActive
                        ? "border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)]"
                        : "border-[var(--app-border-subtle)] bg-[var(--app-bg-muted)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => handleSelectSession(session.sessionId)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="font-mono text-[0.72rem] text-[var(--app-text-muted)]">
                          {session.sessionId.slice(0, 8)}
                        </div>
                        <div
                          className={`mt-2 text-sm font-medium ${getStateTone(session.loopState)}`}
                        >
                          {session.loopState}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleDeleteSession(session.sessionId)
                        }
                        disabled={isDeleting}
                        className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-2.5 py-1 text-[0.72rem] text-[var(--app-text-muted)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isDeleting ? "删除中" : "删除"}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectSession(session.sessionId)}
                      className="mt-3 block w-full text-left"
                    >
                      <div className="text-xs leading-6 text-[var(--app-text-secondary)]">
                        {session.lastUserMessage ?? "还没有用户输入"}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[0.72rem] text-[var(--app-text-muted)]">
                        <span>{formatTimestamp(session.updatedAt)}</span>
                        {session.pendingConfirmation ? (
                          <span className="text-[var(--app-status-warning)]">
                            等待确认
                          </span>
                        ) : isActive ? (
                          <span>当前</span>
                        ) : null}
                      </div>
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-4 px-4 py-4 lg:px-6">
        <section className="rounded-[var(--app-radius-xl)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-4 shadow-[var(--app-shadow-sm)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)]"
              >
                会话侧边栏
              </button>
              <div>
                <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Active Session
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span className="font-mono text-[var(--app-text-primary)]">
                    {currentSession?.sessionId ?? "loading"}
                  </span>
                  <span
                    className={`font-medium ${getStateTone(
                      currentSession?.sessionState.loopState ?? "idle"
                    )}`}
                  >
                    {currentSession?.sessionState.loopState ?? "idle"}
                  </span>
                  <span className="text-[var(--app-text-secondary)]">
                    {currentSession?.context.currentDateContext ?? "--"}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-sm text-[var(--app-text-secondary)]">
              {loadingSession
                ? "正在同步当前会话..."
                : `${sessions.length} 个会话`}
            </div>
          </div>
        </section>

        <div className="grid min-h-0 min-w-0 flex-1 gap-4 min-[700px]:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.95fr)]">
          <div className="min-h-0 min-w-0">
            <WorkbenchPanel
              eyebrow="Conversation"
              title="对话与执行"
              meta={loadingSession ? "syncing" : "live"}
            >
              <div className="flex min-h-[42rem] flex-col gap-4 lg:min-h-[calc(100vh-11rem)]">
                <div className="flex-1 overflow-y-auto pr-1">
                  <div className="grid gap-4">
                    {loading && !currentSession ? (
                      <div className="rounded-[var(--app-radius-lg)] border border-dashed border-[var(--app-border-subtle)] px-4 py-10 text-sm text-[var(--app-text-muted)]">
                        正在初始化工作台...
                      </div>
                    ) : null}

                    {timelineEntries.length ? (
                      timelineEntries.map((entry) => entry.node)
                    ) : (
                      <div className="rounded-[var(--app-radius-lg)] border border-dashed border-[var(--app-border-subtle)] px-4 py-6 text-sm text-[var(--app-text-muted)]">
                        发送请求后，这里会按单条时间线展示用户输入、thinking、tool
                        call、tool result 和助手回复。
                      </div>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="grid gap-3">
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={4}
                    placeholder="输入你的日程请求，观察 thinking、tool call 和完整 prompt。"
                    className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm leading-7 text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />

                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="grid gap-2 text-xs text-[var(--app-text-muted)]">
                        <span className="uppercase tracking-[0.18em]">
                          Max Turns
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={MAX_TURNS_LIMIT}
                          value={maxTurns}
                          onChange={(event) => setMaxTurns(event.target.value)}
                          onBlur={() =>
                            setMaxTurns(String(normalizeMaxTurns(maxTurns)))
                          }
                          className="w-24 rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-2 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
                        />
                      </label>
                      <div className="text-xs text-[var(--app-text-muted)]">
                        {submitting
                          ? "正在流式接收本轮事件..."
                          : "提交后会实时展示 thinking / tool call / tool result。"}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={
                        !currentSession || !message.trim() || submitting
                      }
                      className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-5 py-2 text-sm font-medium text-[var(--app-text-primary)] transition disabled:cursor-not-allowed disabled:opacity-50 hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)]"
                    >
                      {submitting ? "Running..." : "发送"}
                    </button>
                  </div>

                  {errorText ? (
                    <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[var(--app-bg-muted)] px-4 py-3 text-sm text-[var(--app-status-danger)]">
                      {errorText}
                    </div>
                  ) : null}
                </form>
              </div>
            </WorkbenchPanel>
          </div>

          <div className="grid min-h-0 min-w-0 gap-4 min-[700px]:grid-rows-[auto_minmax(0,1fr)]">
            <WorkbenchPanel
              eyebrow="Calendar"
              title="7 天只读周历"
              meta={currentSession?.context.currentDateContext ?? "--"}
              headerActions={
                <button
                  type="button"
                  onClick={handleResetAllRoutines}
                  disabled={
                    !currentSession ||
                    loadingSession ||
                    submitting ||
                    resettingRoutines
                  }
                  className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resettingRoutines ? "重置中..." : "重置所有日程"}
                </button>
              }
            >
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
                {weekDates.map((date) => (
                  <div
                    key={date}
                    className="min-w-0 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-muted)] px-3 py-3"
                  >
                    <div className="text-[0.72rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                      {formatDayLabel(date)}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {(groupedRoutines.get(date) ?? []).map((routine) => (
                        <div
                          key={routine.id}
                          className="rounded-[var(--app-radius-md)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-2 py-2"
                        >
                          <div className="text-xs font-medium text-[var(--app-text-primary)]">
                            {routine.name}
                          </div>
                          <div className="mt-1 text-[0.72rem] text-[var(--app-text-secondary)]">
                            {routine.startTime} - {routine.endTime}
                          </div>
                        </div>
                      ))}
                      {!groupedRoutines.get(date)?.length ? (
                        <div className="rounded-[var(--app-radius-md)] border border-dashed border-[var(--app-border-subtle)] px-2 py-3 text-[0.72rem] text-[var(--app-text-muted)]">
                          暂无日程
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel
              eyebrow="Inspector"
              title="模型看到的完整内容"
              meta={`${inspectorEvents.length} events`}
            >
              <div className="flex min-h-[28rem] min-w-0 flex-col">
                <div className="flex min-w-0 flex-wrap gap-2">
                  {inspectorTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`rounded-[var(--app-radius-pill)] border px-3 py-1.5 text-xs font-medium transition ${
                        activeTab === tab.id
                          ? "border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] text-[var(--app-text-primary)]"
                          : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-secondary)]"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
                  {activeTab === "prompt" ? (
                    latestPromptEvent && latestPromptEvent.kind === "prompt" ? (
                      <div className="grid min-w-0 gap-4">
                        <div className="min-w-0">
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            System
                          </p>
                          <pre className={getDebugPreClass()}>
                            {latestPromptEvent.system}
                          </pre>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            Prefix Messages
                          </p>
                          <pre className={getDebugPreClass()}>
                            {stringify(latestPromptEvent.prefixMessages)}
                          </pre>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            Messages
                          </p>
                          <pre className={getDebugPreClass()}>
                            {stringify(latestPromptEvent.messages)}
                          </pre>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            Tools / Choice
                          </p>
                          <pre className={getDebugPreClass()}>
                            {stringify({
                              tools: latestPromptEvent.tools,
                              toolChoice: latestPromptEvent.toolChoice,
                              cacheKey: latestPromptEvent.cacheKey
                            })}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[var(--app-radius-lg)] border border-dashed border-[var(--app-border-subtle)] px-4 py-6 text-sm text-[var(--app-text-muted)]">
                        暂无 prompt 事件。
                      </div>
                    )
                  ) : null}

                  {activeTab === "thinking" ? (
                    thinkingEvents.length ? (
                      <div className="grid min-w-0 gap-3">
                        {thinkingEvents.map((event) => (
                          <article
                            key={`${event.createdAt}-${event.signature}`}
                            className={getInspectorCardClass(
                              "text-sm leading-7 text-[var(--app-text-muted)]"
                            )}
                          >
                            <div className="mb-2 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                              {formatTimestamp(event.createdAt)}
                            </div>
                            <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                              {event.text}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[var(--app-radius-lg)] border border-dashed border-[var(--app-border-subtle)] px-4 py-6 text-sm text-[var(--app-text-muted)]">
                        暂无 thinking 事件。
                      </div>
                    )
                  ) : null}

                  {activeTab === "tools" ? (
                    toolRows.length ? (
                      <div className="grid min-w-0 gap-4">
                        {toolRows.map((row) => (
                          <article
                            key={row.toolCallId}
                            className={getInspectorCardClass()}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="break-all text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                  {row.toolCallId}
                                </div>
                                <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
                                  {row.toolName}
                                </div>
                              </div>
                              <div
                                className={`text-xs ${
                                  row.isError
                                    ? "text-[var(--app-status-danger)]"
                                    : "text-[var(--app-status-success)]"
                                }`}
                              >
                                {row.isError ? "failed" : "ok"}
                              </div>
                            </div>
                            <div className="mt-4 grid min-w-0 gap-3">
                              <div className="min-w-0">
                                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                  Input
                                </p>
                                <pre className={getDebugPreClass("surface")}>
                                  {row.input ? stringify(row.input) : "null"}
                                </pre>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                  Raw Output
                                </p>
                                <pre className={getDebugPreClass("surface")}>
                                  {row.output ?? "pending"}
                                </pre>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                  Display Text
                                </p>
                                <pre className={getDebugPreClass("surface")}>
                                  {row.displayText ?? "pending"}
                                </pre>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[var(--app-radius-lg)] border border-dashed border-[var(--app-border-subtle)] px-4 py-6 text-sm text-[var(--app-text-muted)]">
                        暂无工具事件。
                      </div>
                    )
                  ) : null}

                  {activeTab === "trace" ? (
                    inspectorEvents.length ? (
                      <div className="grid min-w-0 gap-2">
                        {inspectorEvents.map((event) => (
                          <div
                            key={getExecutionEventKey(event)}
                            className="min-w-0 rounded-[var(--app-radius-md)] border border-[var(--app-border-subtle)] px-3 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                {event.kind}
                              </div>
                              <div className="text-[0.72rem] text-[var(--app-text-muted)]">
                                {formatTimestamp(event.createdAt)}
                              </div>
                            </div>
                            <pre className="mt-3 min-w-0 whitespace-pre-wrap break-all text-xs leading-6 text-[var(--app-text-secondary)] [overflow-wrap:anywhere]">
                              {stringify(event)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[var(--app-radius-lg)] border border-dashed border-[var(--app-border-subtle)] px-4 py-6 text-sm text-[var(--app-text-muted)]">
                        暂无 trace 事件。
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            </WorkbenchPanel>
          </div>
        </div>
      </div>
    </main>
  );
}
