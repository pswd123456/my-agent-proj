"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import {
  createApiClient,
  toSessionSummary,
  type RoutineRecord,
  type RunStreamEvent,
  type SessionSettingsRecord,
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
import {
  buildTimelineItems,
  getTimelineEventKey,
  type TimelineItem
} from "./ui1-timeline";

const apiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"
});

const inspectorTabs = [
  { id: "prompt", label: "Prompt" },
  { id: "thinking", label: "Thinking" },
  { id: "tools", label: "Tools" },
  { id: "trace", label: "Trace" }
] as const;

const DEFAULT_MAX_TURNS = 50;
const MAX_TURNS_LIMIT = 200;
const DEFAULT_CONTEXT_WINDOW = 200_000;

type InspectorTabId = (typeof inspectorTabs)[number]["id"];

interface TurnUsageSummary {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

interface SettingsFormState {
  workingDirectory: string;
  yoloMode: boolean;
  contextWindow: string;
  maxTurns: string;
}

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

function formatWorkingDirectory(value: string): string {
  if (value.length <= 48) {
    return value;
  }

  return `${value.slice(0, 24)}...${value.slice(-18)}`;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatTokenCount(value: number): string {
  return Math.max(0, value).toLocaleString("zh-CN");
}

function formatCacheUsage(usage: {
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}): string {
  return `read ${formatTokenCount(usage.cacheReadInputTokens)} / write ${formatTokenCount(usage.cacheCreationInputTokens)}`;
}

function collectTurnUsage(
  events: RunStreamEvent[]
): Map<number, TurnUsageSummary> {
  const usageByTurn = new Map<number, TurnUsageSummary>();

  for (const event of events) {
    if (event.kind !== "response") {
      continue;
    }

    const current = usageByTurn.get(event.turnCount) ?? {
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0
    };

    usageByTurn.set(event.turnCount, {
      inputTokens: current.inputTokens + event.usage.inputTokens,
      cacheReadInputTokens:
        current.cacheReadInputTokens + event.usage.cacheReadInputTokens,
      cacheCreationInputTokens:
        current.cacheCreationInputTokens + event.usage.cacheCreationInputTokens
    });
  }

  return usageByTurn;
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

function getPermissionFamilyLabel(family: string): string {
  switch (family) {
    case "workspace-file":
      return "workspace file";
    case "workspace-shell":
      return "workspace shell";
    case "workspace-network":
      return "workspace network";
    case "schedule":
      return "schedule";
    default:
      return family;
  }
}

function getPermissionDecisionLabel(
  decision: "requested" | "approved" | "rejected" | "blocked" | null
): string {
  switch (decision) {
    case "requested":
      return "waiting";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "blocked":
      return "blocked";
    default:
      return "none";
  }
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
      ? "bg-[color:color-mix(in_srgb,var(--app-bg-surface)_88%,white_12%)]"
      : "bg-[color:color-mix(in_srgb,var(--app-bg-muted)_88%,var(--app-bg-surface)_12%)]";

  return `mt-2 min-w-0 whitespace-pre-wrap rounded-[var(--app-radius-lg)] ${backgroundClass} px-3 py-3 text-xs leading-6 text-[var(--app-text-secondary)] [overflow-wrap:anywhere]`;
}

function getInspectorCardClass(extraClassName = ""): string {
  return `min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_86%,var(--app-bg-surface)_14%)] px-4 py-4 ${extraClassName}`.trim();
}

function getSoftBlockClass(extraClassName = ""): string {
  return `min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] px-4 py-4 ${extraClassName}`.trim();
}

function sortSessionSummaries(snapshots: SessionSnapshot[]): SessionSummary[] {
  return snapshots
    .map(toSessionSummary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeMaxTurns(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_MAX_TURNS;
  }

  return Math.min(MAX_TURNS_LIMIT, Math.max(1, parsed));
}

function normalizeContextWindow(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_CONTEXT_WINDOW;
  }

  return Math.max(1_000, parsed);
}

function toSettingsFormState(
  settings: SessionSettingsRecord | null
): SettingsFormState {
  return {
    workingDirectory: settings?.workingDirectory ?? "",
    yoloMode: settings?.yoloMode ?? false,
    contextWindow: String(settings?.contextWindow ?? DEFAULT_CONTEXT_WINDOW),
    maxTurns: String(settings?.maxTurns ?? DEFAULT_MAX_TURNS)
  };
}

function patchSettingsForm(
  current: SettingsFormState,
  patch: Partial<SettingsFormState>
): SettingsFormState {
  return {
    ...current,
    ...patch
  };
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

function renderAssistantMessageBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "assistant" }>
) {
  return (
    <div key={block.id} className={getBubbleClass("assistant")}>
      {block.content}
    </div>
  );
}

function renderToolCallBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "tool call" }>
) {
  return (
    <article key={block.id} className={getInspectorCardClass()}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Tool Call
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
            {block.toolName}
          </div>
        </div>
        <div className="text-[0.72rem] text-[var(--app-text-muted)]">
          {formatTimestamp(block.createdAt)}
        </div>
      </div>
      <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
        {stringify(block.input)}
      </pre>
    </article>
  );
}

function renderToolResultBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "tool result" }>
) {
  return (
    <article key={block.id} className={getInspectorCardClass()}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Tool Result
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
            {block.toolName}
          </div>
        </div>
        <div
          className={`text-[0.72rem] ${
            block.isError
              ? "text-[var(--app-status-danger)]"
              : "text-[var(--app-status-success)]"
          }`}
        >
          {block.isError ? "failed" : "ok"}
        </div>
      </div>
      <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
        {block.output}
      </pre>
    </article>
  );
}

function renderConversationBlock(block: SessionSnapshot["messages"][number]) {
  if (block.kind === "user") {
    return renderUserMessageBlock(block);
  }

  if (block.kind === "assistant") {
    return renderAssistantMessageBlock(block);
  }

  if (block.kind === "tool call") {
    return renderToolCallBlock(block);
  }

  return renderToolResultBlock(block);
}

function renderPendingUserMessage(text: string, createdAt: string) {
  return (
    <div key={`pending-user-${createdAt}`} className={getBubbleClass("user")}>
      {text}
    </div>
  );
}

function renderTimelineItem(
  item: TimelineItem,
  turnUsageByTurnCount: Map<number, TurnUsageSummary>
) {
  if (item.type === "event") {
    return renderExecutionEvent(item.event, turnUsageByTurnCount);
  }

  if (item.type === "pending-user") {
    return renderPendingUserMessage(item.text, item.createdAt);
  }

  return renderConversationBlock(item.block);
}

function renderExecutionEvent(
  event: RunStreamEvent,
  turnUsageByTurnCount: Map<number, TurnUsageSummary>
) {
  if (event.kind === "assistant_text") {
    return (
      <div
        key={getTimelineEventKey(event)}
        className={getBubbleClass("assistant")}
      >
        {event.text}
      </div>
    );
  }

  if (event.kind === "thinking") {
    return (
      <article
        key={getTimelineEventKey(event)}
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
        key={getTimelineEventKey(event)}
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

  if (
    event.kind === "permission_request" ||
    event.kind === "permission_approved" ||
    event.kind === "permission_rejected"
  ) {
    const toneClass =
      event.kind === "permission_approved"
        ? "text-[var(--app-status-success)]"
        : event.kind === "permission_rejected"
          ? "text-[var(--app-status-danger)]"
          : "text-[var(--app-status-warning)]";

    return (
      <article
        key={getTimelineEventKey(event)}
        className={getInspectorCardClass()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              Permission
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              {event.toolName}
            </div>
          </div>
          <div className={`text-[0.72rem] ${toneClass}`}>
            {event.kind.replace("permission_", "")}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--app-text-secondary)]">
          <div>{event.request.summaryText}</div>
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
            {getPermissionFamilyLabel(event.request.family)} /{" "}
            {event.request.permissionProfile}
          </div>
          {event.request.contextNote ? (
            <div className="text-[var(--app-text-muted)]">
              {event.request.contextNote}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  if (event.kind === "permission_blocked") {
    return (
      <article
        key={getTimelineEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,var(--app-bg-muted)_88%)] px-4 py-4 text-sm leading-7 text-[var(--app-status-danger)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em]">
            Permission Blocked
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3 text-[var(--app-text-primary)]">
          {event.toolName}
        </div>
        <div className="mt-2">{event.reason}</div>
      </article>
    );
  }

  if (event.kind === "tool_result") {
    return (
      <article
        key={getTimelineEventKey(event)}
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
    const turnUsage =
      event.kind === "turn_end"
        ? (turnUsageByTurnCount.get(event.turnCount) ?? null)
        : null;

    return (
      <div
        key={getTimelineEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-text-primary)]">
          {event.kind === "turn_start"
            ? `Turn ${event.turnCount} started`
            : `Turn ${event.turnCount} ended`}
          {turnUsage
            ? ` / input ${formatTokenCount(turnUsage.inputTokens)} / ${formatCacheUsage(turnUsage)}`
            : ""}
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
        key={getTimelineEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-muted)_88%)] px-4 py-4 text-sm leading-7 text-[var(--app-text-secondary)]"
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
        key={getTimelineEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,var(--app-bg-muted)_88%)] px-4 py-4 text-sm leading-7 text-[var(--app-status-danger)]"
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
        key={getTimelineEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-text-primary)]">
          response / input {event.usage.inputTokens} / output{" "}
          {event.usage.outputTokens} / {formatCacheUsage(event.usage)}
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
        key={getTimelineEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-status-success)_12%,var(--app-bg-muted)_88%)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
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
  const preferredUserIdRef = useRef<string | null>(null);

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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null
  );
  const [resettingRoutines, setResettingRoutines] = useState(false);
  const [userSettings, setUserSettings] =
    useState<SessionSettingsRecord | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(
    toSettingsFormState(null)
  );
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [maxTurns, setMaxTurns] = useState(String(DEFAULT_MAX_TURNS));
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    preferredUserIdRef.current =
      currentSession?.context.userId ?? userSettings?.userId ?? null;
  }, [currentSession, userSettings]);

  function getCreateSessionPayload(): { userId?: string } {
    const userId = preferredUserIdRef.current?.trim();
    return userId ? { userId } : {};
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setErrorText(null);

      try {
        let snapshots = await apiClient.listSessions();
        if (!snapshots.length) {
          const created = await apiClient.createSession(getCreateSessionPayload());
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
      setLoadingSettings(true);
      setErrorText(null);

      try {
        const session = await apiClient.getSession(sessionId);
        const week = buildWeekRange(session.context.currentDateContext);
        const [trace, routinesResult, settings] = await Promise.all([
          apiClient.getSessionTrace(sessionId),
          apiClient.listSessionRoutines(sessionId, {
            startDate: week.startDate,
            endDate: week.endDate
          }),
          apiClient.getUserSettings(session.context.userId)
        ]);

        if (cancelled) {
          return;
        }

        setCurrentSession(session);
        setTraceRecords(trace);
        setRoutines(routinesResult.routines);
        setUserSettings(settings);
        setSettingsForm(toSettingsFormState(settings));
        setMaxTurns(String(session.maxTurns));
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
          setLoadingSettings(false);
        }
      }
    }

    void hydrateSession(selectedSessionId);

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  async function refreshSelectedSession(sessionId: string) {
    setLoadingSettings(true);
    try {
      const session = await apiClient.getSession(sessionId);
      const week = buildWeekRange(session.context.currentDateContext);
      const [trace, routinesResult, settings] = await Promise.all([
        apiClient.getSessionTrace(sessionId),
        apiClient.listSessionRoutines(sessionId, {
          startDate: week.startDate,
          endDate: week.endDate
        }),
        apiClient.getUserSettings(session.context.userId)
      ]);

      setCurrentSession(session);
      setTraceRecords(trace);
      setRoutines(routinesResult.routines);
      setUserSettings(settings);
      setSettingsForm(toSettingsFormState(settings));
      setMaxTurns(String(session.maxTurns));
      setSessions((current) =>
        mergeSessionSummary(current, session, toSessionSummary)
      );
      setStreamEvents([]);
    } finally {
      setLoadingSettings(false);
    }
  }

  function handleOpenCreateSessionDialog() {
    setCreateDialogOpen(true);
  }

  async function handleCreateSession() {
    try {
      setCreatingSession(true);
      setErrorText(null);
      const session = await apiClient.createSession(getCreateSessionPayload());
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
      setCreateDialogOpen(false);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingSession(false);
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

      const newSession = await apiClient.createSession(
        getCreateSessionPayload()
      );
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

  async function submitSessionMessage(nextMessage: string) {
    if (!currentSession || !nextMessage.trim() || submitting) {
      return;
    }

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitSessionMessage(message.trim());
  }

  async function handlePermissionQuickReply(reply: "确认" | "取消") {
    await submitSessionMessage(reply);
  }

  async function handleSaveUserSettings() {
    if (!currentSession || savingSettings) {
      return;
    }

    setSavingSettings(true);
    setErrorText(null);

    try {
      const updated = await apiClient.updateUserSettings(
        currentSession.context.userId,
        {
          workingDirectory: settingsForm.workingDirectory,
          yoloMode: settingsForm.yoloMode,
          contextWindow: normalizeContextWindow(settingsForm.contextWindow),
          maxTurns: normalizeMaxTurns(settingsForm.maxTurns)
        }
      );
      setUserSettings(updated);
      setSettingsForm(toSettingsFormState(updated));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSettings(false);
    }
  }

  const activeUserId = currentSession?.context.userId ?? userSettings?.userId;
  const settingsMeta = loadingSettings
    ? "syncing"
    : activeUserId
      ? `user ${activeUserId}`
      : "--";

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
  const turnUsageByTurnCount = collectTurnUsage([
    ...historyEvents,
    ...streamEvents
  ]);
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
  const pendingPermissionRequest =
    currentSession?.context.pendingPermissionRequest ?? null;
  const timelineEntries = buildTimelineItems({
    messages: currentSession?.messages ?? [],
    historyEvents,
    streamEvents,
    pendingUserMessage
  }).map((item) => ({
    key: item.key,
    node: renderTimelineItem(item, turnUsageByTurnCount)
  }));

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

      {createDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="关闭创建会话弹窗"
            onClick={() => setCreateDialogOpen(false)}
            className="absolute inset-0 bg-black/55"
          />
          <div className="relative z-10 w-full max-w-lg rounded-[var(--app-radius-xl)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-5 py-5 shadow-[var(--app-shadow-lg)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Create Session
                </div>
                <div className="mt-2 text-lg font-semibold text-[var(--app-text-primary)]">
                  新建会话
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--app-text-secondary)]">
                  会话会继承当前 user settings 的默认 cwd、YOLO、context window
                  和 max turns。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateDialogOpen(false)}
                className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-xs text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
              >
                关闭
              </button>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreateDialogOpen(false)}
                className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleCreateSession()}
                disabled={creatingSession}
                className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingSession ? "创建中..." : "创建会话"}
              </button>
            </div>
          </div>
        </div>
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
                onClick={handleOpenCreateSessionDialog}
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
                    className={`rounded-[var(--app-radius-lg)] px-3 py-3 transition ${
                      isActive
                        ? "bg-[color:color-mix(in_srgb,var(--app-bg-elevated)_72%,var(--app-bg-surface)_28%)] shadow-[inset_0_0_0_1px_var(--app-border-accent)]"
                        : "bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--app-bg-muted)_92%,var(--app-bg-surface)_8%)]"
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
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.72rem] text-[var(--app-text-muted)]">
                        <span>{formatTimestamp(session.updatedAt)}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          {session.pendingPermission ? (
                            <span className="text-[var(--app-status-warning)]">
                              等待 permission
                            </span>
                          ) : null}
                          {session.pendingConfirmation ? (
                            <span className="text-[var(--app-status-warning)]">
                              等待确认
                            </span>
                          ) : null}
                          {session.yoloMode ? (
                            <span className="text-[var(--app-status-success)]">
                              yolo on
                            </span>
                          ) : null}
                          {isActive ? <span>当前</span> : null}
                        </div>
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
        <section className="rounded-[var(--app-radius-xl)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_90%,var(--app-bg-elevated)_10%)] px-4 py-4 shadow-[var(--app-shadow-sm)]">
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
                  <span className="text-[var(--app-text-secondary)]">
                    {currentSession?.context.currentDateContext ?? "--"}
                  </span>
                  <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] text-[var(--app-text-secondary)]">
                    status {currentSession?.context.status ?? "--"}
                  </span>
                  <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 font-mono text-[0.72rem] text-[var(--app-text-secondary)]">
                    cwd{" "}
                    {formatWorkingDirectory(
                      currentSession?.workingDirectory ?? "--"
                    )}
                  </span>
                  <span
                    className={`rounded-[var(--app-radius-pill)] border px-3 py-1 text-[0.72rem] ${
                      currentSession?.context.yoloMode
                        ? "border-[var(--app-status-success)] text-[var(--app-status-success)]"
                        : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)]"
                    }`}
                  >
                    yolo {currentSession?.context.yoloMode ? "on" : "off"}
                  </span>
                  <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 font-mono text-[0.72rem] text-[var(--app-text-secondary)]">
                    ctx{" "}
                    {currentSession
                      ? formatTokenCount(currentSession.contextWindow)
                      : "--"}
                  </span>
                  <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 font-mono text-[0.72rem] text-[var(--app-text-secondary)]">
                    session maxTurns {currentSession?.maxTurns ?? "--"}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-sm text-[var(--app-text-secondary)]">
              {loadingSession
                ? "正在同步当前会话..."
                : `${sessions.length} 个会话 / total input ${
                    currentSession
                      ? formatTokenCount(currentSession.inputTokensCount)
                      : "--"
                  }`}
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
                      <div
                        className={getSoftBlockClass(
                          "py-10 text-sm text-[var(--app-text-muted)]"
                        )}
                      >
                        正在初始化工作台...
                      </div>
                    ) : null}

                    {timelineEntries.length ? (
                      timelineEntries.map((entry) => entry.node)
                    ) : (
                      <div
                        className={getSoftBlockClass(
                          "py-6 text-sm text-[var(--app-text-muted)]"
                        )}
                      >
                        发送请求后，这里会按单条时间线展示用户输入、thinking、tool
                        call、tool result 和助手回复。
                      </div>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="grid gap-3">
                  {pendingPermissionRequest ? (
                    <div className="rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-status-warning)_56%,var(--app-border-subtle)_44%)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-muted)_88%)] px-4 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            Permission Request
                          </div>
                          <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
                            {pendingPermissionRequest.toolName}
                          </div>
                          <div className="mt-2 text-sm leading-7 text-[var(--app-text-secondary)]">
                            {pendingPermissionRequest.summaryText}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[0.72rem]">
                            <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-2.5 py-1 text-[var(--app-text-secondary)]">
                              {getPermissionFamilyLabel(
                                pendingPermissionRequest.family
                              )}
                            </span>
                            <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-2.5 py-1 text-[var(--app-text-secondary)]">
                              {pendingPermissionRequest.permissionProfile}
                            </span>
                            <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-2.5 py-1 text-[var(--app-text-secondary)]">
                              cwd{" "}
                              {formatWorkingDirectory(
                                currentSession?.workingDirectory ?? "--"
                              )}
                            </span>
                            <span
                              className={`rounded-[var(--app-radius-pill)] border px-2.5 py-1 ${
                                currentSession?.context.yoloMode
                                  ? "border-[var(--app-status-success)] text-[var(--app-status-success)]"
                                  : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)]"
                              }`}
                            >
                              yolo{" "}
                              {currentSession?.context.yoloMode ? "on" : "off"}
                            </span>
                          </div>
                          {pendingPermissionRequest.contextNote ? (
                            <div className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                              {pendingPermissionRequest.contextNote}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handlePermissionQuickReply("确认")
                            }
                            disabled={submitting}
                            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            确认执行
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void handlePermissionQuickReply("取消")
                            }
                            disabled={submitting}
                            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={4}
                    placeholder="输入你的请求，观察 thinking、tool call 和完整 prompt。"
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
                          : "这里的 maxTurns 只覆盖当前这次 runtime.run(...)。"}
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
                    <div className="rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,var(--app-bg-muted)_88%)] px-4 py-3 text-sm text-[var(--app-status-danger)]">
                      {errorText}
                    </div>
                  ) : null}
                </form>
              </div>
            </WorkbenchPanel>
          </div>

          <div className="grid min-h-0 min-w-0 gap-4 min-[700px]:grid-rows-[auto_auto_minmax(0,1fr)]">
            <WorkbenchPanel
              eyebrow="Settings"
              title="用户默认设置"
              meta={settingsMeta}
              headerActions={
                <button
                  type="button"
                  onClick={() => void handleSaveUserSettings()}
                  disabled={
                    !currentSession || loadingSettings || savingSettings
                  }
                  className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSettings ? "保存中..." : "保存 settings"}
                </button>
              }
            >
              <div className="grid gap-3">
                <div
                  className={getSoftBlockClass(
                    "text-sm leading-6 text-[var(--app-text-secondary)]"
                  )}
                >
                  新建会话会读取这里的默认 `cwd / yolo / context window / max
                  turns`。保存后只影响后续新建 session，不会回写当前 session
                  的运行态。
                </div>

                <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                  <span className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                    Default Working Directory
                  </span>
                  <input
                    value={settingsForm.workingDirectory}
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        patchSettingsForm(current, {
                          workingDirectory: event.target.value
                        })
                      )
                    }
                    placeholder="agent-workspace"
                    className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                  <span className="text-xs leading-6 text-[var(--app-text-muted)]">
                    留空会回到 repo 根下的 `agent-workspace/`。自定义 cwd
                    会被解析并限制在仓库根目录内。
                  </span>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                    <span className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                      Context Window
                    </span>
                    <input
                      type="number"
                      min={1_000}
                      value={settingsForm.contextWindow}
                      onChange={(event) =>
                        setSettingsForm((current) =>
                          patchSettingsForm(current, {
                            contextWindow: event.target.value
                          })
                        )
                      }
                      onBlur={() =>
                        setSettingsForm((current) =>
                          patchSettingsForm(current, {
                            contextWindow: String(
                              normalizeContextWindow(current.contextWindow)
                            )
                          })
                        )
                      }
                      className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
                    />
                  </label>

                  <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                    <span className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                      Default Max Turns
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={MAX_TURNS_LIMIT}
                      value={settingsForm.maxTurns}
                      onChange={(event) =>
                        setSettingsForm((current) =>
                          patchSettingsForm(current, {
                            maxTurns: event.target.value
                          })
                        )
                      }
                      onBlur={() =>
                        setSettingsForm((current) =>
                          patchSettingsForm(current, {
                            maxTurns: String(
                              normalizeMaxTurns(current.maxTurns)
                            )
                          })
                        )
                      }
                      className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
                    />
                  </label>
                </div>

                <label className="flex items-center justify-between gap-4 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] px-4 py-4">
                  <div>
                    <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                      YOLO Mode
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--app-text-secondary)]">
                      仅作为新会话默认值。它只影响可审批的 destructive file
                      操作，不会绕过 shell / network 审批和 sandbox。
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsForm.yoloMode}
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        patchSettingsForm(current, {
                          yoloMode: event.target.checked
                        })
                      )
                    }
                    disabled={loadingSettings || savingSettings}
                    className="h-5 w-5 rounded border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] text-[var(--app-status-success)]"
                  />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--app-text-muted)]">
                  <span>
                    {loadingSettings
                      ? "正在同步 user settings..."
                      : userSettings
                        ? `上次保存 ${formatTimestamp(userSettings.updatedAt)}`
                        : "settings 尚未加载"}
                  </span>
                  <span>
                    当前 session: cwd{" "}
                    {formatWorkingDirectory(
                      currentSession?.workingDirectory ?? "--"
                    )}{" "}
                    / yolo {currentSession?.context.yoloMode ? "on" : "off"}
                  </span>
                </div>
              </div>
            </WorkbenchPanel>

            <WorkbenchPanel
              eyebrow="Schedule Pack"
              title="当前日程能力视图"
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
                  {resettingRoutines ? "清空中..." : "清空日程数据"}
                </button>
              }
            >
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
                {weekDates.map((date) => (
                  <div
                    key={date}
                    className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_84%,var(--app-bg-surface)_16%)] px-3 py-3"
                  >
                    <div className="text-[0.72rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                      {formatDayLabel(date)}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {(groupedRoutines.get(date) ?? []).map((routine) => (
                        <div
                          key={routine.id}
                          className="rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_90%,white_10%)] px-3 py-2"
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
                        <div className="rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_58%,transparent)] px-3 py-3 text-[0.72rem] text-[var(--app-text-muted)]">
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
                        <div className={getSoftBlockClass()}>
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            System
                          </p>
                          <pre className={getDebugPreClass()}>
                            {latestPromptEvent.system}
                          </pre>
                        </div>
                        <div className={getSoftBlockClass()}>
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            Prefix Messages
                          </p>
                          <pre className={getDebugPreClass()}>
                            {stringify(latestPromptEvent.prefixMessages)}
                          </pre>
                        </div>
                        <div className={getSoftBlockClass()}>
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            Messages
                          </p>
                          <pre className={getDebugPreClass()}>
                            {stringify(latestPromptEvent.messages)}
                          </pre>
                        </div>
                        <div className={getSoftBlockClass()}>
                          <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                            Runtime Context Messages
                          </p>
                          <pre className={getDebugPreClass()}>
                            {stringify(
                              latestPromptEvent.runtimeContextMessages
                            )}
                          </pre>
                        </div>
                        <div className={getSoftBlockClass()}>
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
                      <div
                        className={getSoftBlockClass(
                          "py-6 text-sm text-[var(--app-text-muted)]"
                        )}
                      >
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
                      <div
                        className={getSoftBlockClass(
                          "py-6 text-sm text-[var(--app-text-muted)]"
                        )}
                      >
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
                              <div className={getSoftBlockClass("px-3 py-3")}>
                                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                  Input
                                </p>
                                <pre className={getDebugPreClass("surface")}>
                                  {row.input ? stringify(row.input) : "null"}
                                </pre>
                              </div>
                              <div className={getSoftBlockClass("px-3 py-3")}>
                                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                  Raw Output
                                </p>
                                <pre className={getDebugPreClass("surface")}>
                                  {row.output ?? "pending"}
                                </pre>
                              </div>
                              <div className={getSoftBlockClass("px-3 py-3")}>
                                <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                  Display Text
                                </p>
                                <pre className={getDebugPreClass("surface")}>
                                  {row.displayText ?? "pending"}
                                </pre>
                              </div>
                              {(row.permissionDecision ||
                                row.permissionSummary ||
                                row.permissionReason) && (
                                <div className={getSoftBlockClass("px-3 py-3")}>
                                  <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                    Permission
                                  </p>
                                  <pre className={getDebugPreClass("surface")}>
                                    {stringify({
                                      decision: getPermissionDecisionLabel(
                                        row.permissionDecision
                                      ),
                                      family: row.permissionFamily,
                                      permissionProfile: row.permissionProfile,
                                      summary: row.permissionSummary,
                                      contextNote: row.permissionContextNote,
                                      reason: row.permissionReason
                                    })}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div
                        className={getSoftBlockClass(
                          "py-6 text-sm text-[var(--app-text-muted)]"
                        )}
                      >
                        暂无工具事件。
                      </div>
                    )
                  ) : null}

                  {activeTab === "trace" ? (
                    inspectorEvents.length ? (
                      <div className="grid min-w-0 gap-2">
                        {inspectorEvents.map((event) => (
                          <div
                            key={getTimelineEventKey(event)}
                            className="min-w-0 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-3 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                                {event.kind}
                              </div>
                              <div className="text-[0.72rem] text-[var(--app-text-muted)]">
                                {formatTimestamp(event.createdAt)}
                              </div>
                            </div>
                            <pre
                              className={getDebugPreClass("surface").replace(
                                "mt-2 ",
                                "mt-3 "
                              )}
                            >
                              {stringify(event)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        className={getSoftBlockClass(
                          "py-6 text-sm text-[var(--app-text-muted)]"
                        )}
                      >
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
