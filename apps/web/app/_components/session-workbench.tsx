"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
  collectTurnUsage,
  flattenTraceRecords,
  findReusableNewSessionSummary,
  groupRoutinesByDate,
  mergeSessionSummary,
  normalizeContextWindow,
  normalizeMaxTurns,
  normalizeSettingsFormState,
  patchSettingsForm,
  sortSessionSummaries,
  splitPatternLines,
  toSettingsFormState
} from "./session-workbench-state";
import { buildTimelineItems, getTimelineEventKey } from "./session-timeline";
import {
  SessionWorkbenchConversationPanel,
  SessionWorkbenchDrawer,
  SessionWorkbenchSidebar
} from "./session-workbench-ui";
import {
  DEFAULT_MAX_TURNS,
  type InspectorTabId,
  type SettingsFormState,
  type SidebarPanelId
} from "./session-workbench-types";

const apiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"
});

const SESSION_RAIL_COLLAPSED_STORAGE_KEY = "workbench-session-rail-collapsed";

export function SessionWorkbench() {
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
  const [activeSidebarPanel, setActiveSidebarPanel] =
    useState<SidebarPanelId | null>(null);
  const [isSessionRailCollapsed, setIsSessionRailCollapsed] = useState(false);
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
  const [pendingPermissionToolName, setPendingPermissionToolName] = useState<
    string | null
  >(null);
  const [maxTurns, setMaxTurns] = useState(String(DEFAULT_MAX_TURNS));
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedValue = window.localStorage.getItem(
      SESSION_RAIL_COLLAPSED_STORAGE_KEY
    );
    if (storedValue === "true") {
      setIsSessionRailCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SESSION_RAIL_COLLAPSED_STORAGE_KEY,
      String(isSessionRailCollapsed)
    );
  }, [isSessionRailCollapsed]);

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
          const created = await apiClient.createSession(
            getCreateSessionPayload()
          );
          snapshots = [created];
        }

        if (cancelled) {
          return;
        }

        const summaries = sortSessionSummaries(snapshots, toSessionSummary);
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

  async function handleCreateSession() {
    if (creatingSession) {
      return;
    }

    const reusableSession = findReusableNewSessionSummary(sessions);
    if (reusableSession) {
      setErrorText(null);
      setSelectedSessionId(reusableSession.sessionId);
      setStreamEvents([]);
      router.replace(`/?sessionId=${reusableSession.sessionId}`, {
        scroll: false
      });
      return;
    }

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

  async function submitSessionMessage(
    nextMessage: string,
    options?: { permissionReply?: boolean }
  ) {
    if (!currentSession || !nextMessage.trim() || submitting) {
      return;
    }

    const sessionId = currentSession.sessionId;
    const nextMaxTurns = normalizeMaxTurns(maxTurns);

    setMaxTurns(String(nextMaxTurns));
    if (!(options?.permissionReply ?? false)) {
      setPendingUserMessage({
        createdAt: new Date().toISOString(),
        text: nextMessage
      });
    }
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
        ...(typeof options?.permissionReply === "boolean"
          ? { permissionReply: options.permissionReply }
          : {}),
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

  async function handlePermissionQuickReply(reply: string) {
    await submitSessionMessage(reply, { permissionReply: true });
  }

  async function handleSaveUserSettings(
    nextForm: SettingsFormState = settingsForm
  ) {
    const targetUserId = currentSession?.context.userId ?? userSettings?.userId;
    if (!targetUserId || savingSettings) {
      return;
    }

    const normalizedForm = normalizeSettingsFormState(nextForm);

    setSavingSettings(true);
    setErrorText(null);
    setSettingsForm(normalizedForm);

    try {
      const updated = await apiClient.updateUserSettings(targetUserId, {
        workingDirectory: normalizedForm.workingDirectory,
        yoloMode: normalizedForm.yoloMode,
        contextWindow: normalizeContextWindow(normalizedForm.contextWindow),
        maxTurns: normalizeMaxTurns(normalizedForm.maxTurns),
        shellAllowPatterns: splitPatternLines(
          normalizedForm.shellAllowPatterns
        ),
        shellDenyPatterns: splitPatternLines(normalizedForm.shellDenyPatterns),
        toolAllowList: normalizedForm.toolAllowList,
        toolAskList: normalizedForm.toolAskList,
        toolDenyList: normalizedForm.toolDenyList
      });
      setUserSettings(updated);
      setSettingsForm(toSettingsFormState(updated));

      if (
        currentSession &&
        currentSession.context.userId === targetUserId
      ) {
        const syncedSession = await apiClient.updateSessionSettings(
          currentSession.sessionId,
          {
            yoloMode: updated.yoloMode,
            shellAllowPatterns: updated.shellAllowPatterns,
            shellDenyPatterns: updated.shellDenyPatterns,
            toolAllowList: updated.toolAllowList,
            toolAskList: updated.toolAskList,
            toolDenyList: updated.toolDenyList
          }
        );
        setCurrentSession(syncedSession);
        setSessions((current) =>
          mergeSessionSummary(current, syncedSession, toSessionSummary)
        );
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSettings(false);
    }
  }

  function handleSettingsFormChange(patch: Partial<SettingsFormState>) {
    setSettingsForm((current) => patchSettingsForm(current, patch));
  }

  async function handleSettingsPermissionToolToggle(
    toolName: string,
    target: "allow" | "ask" | "deny"
  ) {
    if (savingSettings) {
      return;
    }

    const nextForm = patchSettingsForm(settingsForm, {
      toolAllowList:
        target === "allow"
          ? Array.from(new Set([...settingsForm.toolAllowList, toolName]))
          : settingsForm.toolAllowList.filter((item) => item !== toolName),
      toolAskList:
        target === "ask"
          ? Array.from(new Set([...settingsForm.toolAskList, toolName]))
          : settingsForm.toolAskList.filter((item) => item !== toolName),
      toolDenyList:
        target === "deny"
          ? Array.from(new Set([...settingsForm.toolDenyList, toolName]))
          : settingsForm.toolDenyList.filter((item) => item !== toolName)
    });
    if (target === "allow") {
      nextForm.toolAskList = nextForm.toolAskList.filter(
        (item) => item !== toolName
      );
      nextForm.toolDenyList = nextForm.toolDenyList.filter(
        (item) => item !== toolName
      );
    } else if (target === "ask") {
      nextForm.toolAllowList = nextForm.toolAllowList.filter(
        (item) => item !== toolName
      );
      nextForm.toolDenyList = nextForm.toolDenyList.filter(
        (item) => item !== toolName
      );
    } else {
      nextForm.toolAllowList = nextForm.toolAllowList.filter(
        (item) => item !== toolName
      );
      nextForm.toolAskList = nextForm.toolAskList.filter(
        (item) => item !== toolName
      );
    }
    setSettingsForm(nextForm);
    setPendingPermissionToolName(toolName);
    try {
      await handleSaveUserSettings(nextForm);
    } finally {
      setPendingPermissionToolName((current) =>
        current === toolName ? null : current
      );
    }
  }

  function handleToggleSidebarPanel(panelId: SidebarPanelId) {
    setActiveSidebarPanel((current) => (current === panelId ? null : panelId));
  }

  async function handleSettingsYoloModeChange(checked: boolean) {
    const nextForm = patchSettingsForm(settingsForm, {
      yoloMode: checked
    });
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
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

  const activeUserId = currentSession?.context.userId ?? userSettings?.userId;
  const settingsMeta = loadingSettings
    ? "syncing"
    : savingSettings
      ? "autosaving"
      : activeUserId
        ? `user ${activeUserId}`
        : "--";

  const settingsStatusText = savingSettings
    ? "正在自动保存..."
    : loadingSettings
      ? "正在同步默认设置..."
      : activeUserId
        ? "修改后会自动保存，并用于后续新建会话"
        : "设置尚未加载";

  const historyEvents = flattenTraceRecords(traceRecords);
  const inspectorEvents = streamEvents.length ? streamEvents : historyEvents;
  const turnUsageByTurnCount = collectTurnUsage([
    ...historyEvents,
    ...streamEvents
  ]);
  const latestPromptEvent = [...inspectorEvents]
    .reverse()
    .find(
      (event): event is Extract<RunStreamEvent, { kind: "prompt" }> =>
        event.kind === "prompt"
    );
  const thinkingEvents = inspectorEvents.filter(
    (event): event is Extract<RunStreamEvent, { kind: "thinking" }> =>
      event.kind === "thinking"
  );
  const toolRows = collectToolRows(inspectorEvents);
  const groupedRoutines = groupRoutinesByDate(routines);
  const weekDates = currentSession
    ? buildWeekRange(currentSession.context.currentDateContext).dates
    : [];
  const pendingPermissionRequest =
    currentSession?.context.pendingPermissionRequest ?? null;
  const timelineItems = buildTimelineItems({
    messages: currentSession?.messages ?? [],
    historyEvents,
    streamEvents,
    pendingUserMessage
  });
  const streamEventKeys = useMemo(
    () => new Set(streamEvents.map((event) => getTimelineEventKey(event))),
    [streamEvents]
  );
  const showSidebarPanel = activeSidebarPanel !== null;

  return (
    <main className="min-h-screen bg-[var(--app-bg-canvas)] text-[var(--app-text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1760px] flex-col gap-4 px-4 py-4 lg:flex-row lg:items-start lg:gap-5 lg:px-6">
        <SessionWorkbenchSidebar
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          activeSidebarPanel={activeSidebarPanel}
          collapsed={isSessionRailCollapsed}
          deletingSessionId={deletingSessionId}
          loading={loading}
          creatingSession={creatingSession}
          onCreateSession={handleCreateSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={(sessionId) => void handleDeleteSession(sessionId)}
          onToggleCollapsed={() =>
            setIsSessionRailCollapsed((current) => !current)
          }
          onToggleSidebarPanel={handleToggleSidebarPanel}
        />

        <div className="relative min-h-[calc(100vh-2rem)] min-w-0 flex-1">
          {showSidebarPanel ? (
            <SessionWorkbenchDrawer
              activeSidebarPanel={activeSidebarPanel}
              currentSession={currentSession}
              loadingSession={loadingSession}
              submitting={submitting}
              resettingRoutines={resettingRoutines}
              settingsMeta={settingsMeta}
              settingsStatusText={settingsStatusText}
              settingsForm={settingsForm}
              loadingSettings={loadingSettings}
              savingSettings={savingSettings}
              pendingPermissionToolName={pendingPermissionToolName}
              weekDates={weekDates}
              groupedRoutines={groupedRoutines}
              inspectorEvents={inspectorEvents}
              activeTab={activeTab}
              latestPromptEvent={latestPromptEvent}
              thinkingEvents={thinkingEvents}
              toolRows={toolRows}
              onResetAllRoutines={() => void handleResetAllRoutines()}
              onSelectTab={setActiveTab}
              onSettingsFormChange={handleSettingsFormChange}
              onSettingsBlur={() => void handleSaveUserSettings()}
              onSettingsYoloModeChange={(checked) =>
                void handleSettingsYoloModeChange(checked)
              }
              onSettingsPermissionToolToggle={(toolName, target) =>
                void handleSettingsPermissionToolToggle(toolName, target)
              }
            />
          ) : (
            <SessionWorkbenchConversationPanel
              currentSession={currentSession}
              loading={loading}
              loadingSession={loadingSession}
              timelineItems={timelineItems}
              streamEventKeys={streamEventKeys}
              turnUsageByTurnCount={turnUsageByTurnCount}
              pendingPermissionRequest={pendingPermissionRequest}
              message={message}
              submitting={submitting}
              errorText={errorText}
              onMessageChange={setMessage}
              onSubmit={(event) => void handleSubmit(event)}
              onPermissionQuickReply={(reply) =>
                void handlePermissionQuickReply(reply)
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}
