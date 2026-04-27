"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  createApiClient,
  type ModelCatalogEntry,
  type RoutineRecord,
  type RunStreamEvent,
  type SessionSettingsRecord,
  type TraceRecord
} from "@ai-app-template/sdk";

import {
  buildWeekRange,
  canInterruptSessionExecution,
  findReusableNewSessionSummary,
  groupRoutinesByDate,
  normalizeContextWindow,
  normalizeMaxTurns,
  normalizeSettingsFormState,
  patchSettingsForm,
  splitPatternLines,
  toSettingsFormState
} from "./session-workbench-state";
import {
  bootstrapSessions,
  clearCurrentSession,
  createSessionRegistryState,
  deleteSession as deleteSessionFromRegistry,
  deriveRenderedSessions,
  hydrateSelectedSession,
  selectSession,
  upsertSession
} from "./session-registry-manager";
import {
  appendMessageManagerEvent,
  beginMessageManagerRun,
  buildMessageManagerProjection,
  completeMessageManagerAutoCollapse,
  createMessageManagerState,
  finishMessageManagerRun,
  markMessageManagerAnimationComplete,
  registerMessageManagerCollapsedFlows,
  resetMessageManagerState,
  resetMessageManagerViewState,
  toggleMessageManagerExpanded
} from "./session-message-manager";
import {
  applyStreamEventToSessionState,
  beginSessionInterrupt,
  beginSessionSubmission,
  createSessionUiState,
  finishSessionSubmission,
  rollbackSessionUiState,
  setSessionSnapshot
} from "./session-state-manager";
import { isTodoToolName } from "./session-todo-state";
import {
  SessionWorkbenchConversationPanel,
  SessionWorkbenchDrawer,
  SessionWorkbenchSidebar
} from "./session-workbench-ui";
import {
  DEFAULT_MAX_TURNS,
  clearActiveSidebarPanel,
  type InspectorTabId,
  type SettingsFormState,
  type SidebarPanelId
} from "./session-workbench-types";

const apiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"
});

const SESSION_RAIL_COLLAPSED_STORAGE_KEY = "workbench-session-rail-collapsed";
const ACTIVE_SESSION_REFRESH_INTERVAL_MS = 3_000;

type RefreshSelectedSessionOptions = {
  resetRunView?: boolean;
  syncSettings?: boolean;
  showLoadingSettings?: boolean;
};

export function SessionWorkbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId");
  const selectedSessionIdRef = useRef<string | null>(null);
  const preferredUserIdRef = useRef<string | null>(null);
  const backgroundRefreshInFlightRef = useRef(false);

  const [sessionRegistry, setSessionRegistry] = useState(() =>
    createSessionRegistryState()
  );
  const [sessionUiState, setSessionUiState] = useState(() =>
    createSessionUiState(null)
  );
  const [traceRecords, setTraceRecords] = useState<TraceRecord[]>([]);
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [messageManagerState, setMessageManagerState] = useState(() =>
    createMessageManagerState()
  );
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<InspectorTabId>("prompt");
  const [loading, setLoading] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
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
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>([]);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(
    toSettingsFormState(null)
  );
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [pendingPermissionToolName, setPendingPermissionToolName] = useState<
    string | null
  >(null);
  const { sessions, selectedSessionId } = sessionRegistry;
  const [maxTurns, setMaxTurns] = useState(String(DEFAULT_MAX_TURNS));
  const [errorText, setErrorText] = useState<string | null>(null);
  const currentSession = sessionUiState.session;
  const submitting = sessionUiState.submitting;
  const interruptingSessionId = sessionUiState.interruptingSessionId;

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

  const renderedSessions = useMemo(
    () => deriveRenderedSessions({ ...sessionRegistry, currentSession }),
    [currentSession, sessionRegistry]
  );

  function getCreateSessionPayload(): { userId?: string } {
    const userId = preferredUserIdRef.current?.trim();
    return userId ? { userId } : {};
  }

  function focusConversationView() {
    setActiveSidebarPanel(clearActiveSidebarPanel());
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setErrorText(null);

      try {
        const modelsResultPromise = apiClient.listModels().catch(() => null);
        let snapshots = await apiClient.listSessions();
        if (!snapshots.length) {
          const created = await apiClient.createSession(
            getCreateSessionPayload()
          );
          snapshots = [created];
        }

        const modelsResult = await modelsResultPromise;

        if (cancelled) {
          return;
        }

        if (modelsResult) {
          setModelCatalog(modelsResult.models);
        }
        const nextRegistry = bootstrapSessions(snapshots, requestedSessionId);
        setSessionRegistry(nextRegistry);
        if (nextRegistry.selectedSessionId) {
          router.replace(`/?sessionId=${nextRegistry.selectedSessionId}`, {
            scroll: false
          });
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

        setSessionUiState((current) => setSessionSnapshot(current, session));
        setTraceRecords(trace);
        setRoutines(routinesResult.routines);
        setUserSettings(settings);
        setSettingsForm(toSettingsFormState(settings));
        setMaxTurns(String(session.maxTurns));
        setSessionRegistry((current) =>
          hydrateSelectedSession(current, session)
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

  async function refreshSelectedSession(
    sessionId: string,
    options: RefreshSelectedSessionOptions = {}
  ) {
    const {
      resetRunView: shouldResetRunView = true,
      syncSettings = true,
      showLoadingSettings = true
    } = options;

    if (showLoadingSettings) {
      setLoadingSettings(true);
    }

    try {
      const session = await apiClient.getSession(sessionId);
      const week = buildWeekRange(session.context.currentDateContext);
      const [trace, routinesResult, settings] = await Promise.all([
        apiClient.getSessionTrace(sessionId),
        apiClient.listSessionRoutines(sessionId, {
          startDate: week.startDate,
          endDate: week.endDate
        }),
        syncSettings
          ? apiClient.getUserSettings(session.context.userId)
          : Promise.resolve<SessionSettingsRecord | null>(null)
      ]);

      if (selectedSessionIdRef.current !== sessionId) {
        return;
      }

      setSessionUiState((current) => setSessionSnapshot(current, session));
      setTraceRecords(trace);
      setRoutines(routinesResult.routines);
      if (settings) {
        setUserSettings(settings);
        setSettingsForm(toSettingsFormState(settings));
      }
      setMaxTurns(String(session.maxTurns));
      setSessionRegistry((current) => hydrateSelectedSession(current, session));
      if (shouldResetRunView) {
        setMessageManagerState(resetMessageManagerState());
      }
    } finally {
      if (showLoadingSettings) {
        setLoadingSettings(false);
      }
    }
  }

  useEffect(() => {
    if (
      !currentSession ||
      !canInterruptSessionExecution({
        session: currentSession,
        submitting
      })
    ) {
      return;
    }

    const sessionId = currentSession.sessionId;
    const intervalId = window.setInterval(() => {
      if (
        backgroundRefreshInFlightRef.current ||
        selectedSessionIdRef.current !== sessionId
      ) {
        return;
      }

      backgroundRefreshInFlightRef.current = true;
      void refreshSelectedSession(sessionId, {
        resetRunView: false,
        syncSettings: false,
        showLoadingSettings: false
      })
        .catch(() => undefined)
        .finally(() => {
          backgroundRefreshInFlightRef.current = false;
        });
    }, ACTIVE_SESSION_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    currentSession?.sessionId,
    currentSession?.context.status,
    currentSession?.sessionState.loopState,
    submitting
  ]);

  async function handleCreateSession() {
    if (creatingSession) {
      return;
    }

    const reusableSession = findReusableNewSessionSummary(sessions);
    if (reusableSession) {
      setErrorText(null);
      focusConversationView();
      setSessionRegistry((current) =>
        selectSession(current, reusableSession.sessionId)
      );
      setMessageManagerState(resetMessageManagerState());
      router.replace(`/?sessionId=${reusableSession.sessionId}`, {
        scroll: false
      });
      return;
    }

    try {
      setCreatingSession(true);
      setErrorText(null);
      const session = await apiClient.createSession(getCreateSessionPayload());
      setSessionRegistry((current) =>
        upsertSession(selectSession(current, session.sessionId), session)
      );
      focusConversationView();
      setSessionUiState((current) => setSessionSnapshot(current, session));
      setTraceRecords([]);
      setRoutines([]);
      setMessageManagerState(resetMessageManagerState());
      router.replace(`/?sessionId=${session.sessionId}`, { scroll: false });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingSession(false);
    }
  }

  function handleSelectSession(sessionId: string) {
    focusConversationView();
    setSessionRegistry((current) => selectSession(current, sessionId));
    setMessageManagerState(resetMessageManagerState());
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
      setSessionRegistry((current) =>
        deleteSessionFromRegistry(current, sessionId)
      );

      if (selectedSessionId !== sessionId) {
        return;
      }

      const nextSessionId = remaining[0]?.sessionId ?? null;
      setSessionRegistry((current) => clearCurrentSession(current));
      setSessionUiState((current) => setSessionSnapshot(current, null));
      setTraceRecords([]);
      setRoutines([]);
      setMessageManagerState(resetMessageManagerState());

      if (nextSessionId) {
        setSessionRegistry((current) => selectSession(current, nextSessionId));
        router.replace(`/?sessionId=${nextSessionId}`, { scroll: false });
        return;
      }

      const newSession = await apiClient.createSession(
        getCreateSessionPayload()
      );
      setSessionRegistry(
        hydrateSelectedSession(createSessionRegistryState(), newSession)
      );
      setSessionUiState((current) => setSessionSnapshot(current, newSession));
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
      setMessageManagerState((current) =>
        beginMessageManagerRun(current, {
          createdAt: new Date().toISOString(),
          text: nextMessage
        })
      );
    }
    setMessage("");
    setSessionUiState((current) => beginSessionSubmission(current));
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
            setMessageManagerState((current) =>
              appendMessageManagerEvent(current, runEvent)
            );
            setSessionUiState((current) =>
              applyStreamEventToSessionState(current, runEvent)
            );
          }

          if (
            (runEvent.kind === "run_complete" ||
              runEvent.kind === "run_error") &&
            "session" in runEvent
          ) {
            const nextSession = runEvent.session;
            if (nextSession) {
              setSessionRegistry((current) =>
                upsertSession(current, nextSession)
              );
              if (isActiveSession) {
                setSessionUiState((current) =>
                  setSessionSnapshot(current, nextSession)
                );
              }
            }
          }
        }
      });

      if (isActiveStreamSession()) {
        await refreshSelectedSession(sessionId);
      }
    } catch (error) {
      setSessionUiState((current) =>
        rollbackSessionUiState(current, sessionId)
      );
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionUiState((current) =>
        finishSessionSubmission(current, sessionId)
      );
      setMessageManagerState((current) => finishMessageManagerRun(current));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitSessionMessage(message.trim());
  }

  async function handlePermissionQuickReply(reply: string) {
    await submitSessionMessage(reply, { permissionReply: true });
  }

  async function handleInterruptSession() {
    if (!currentSession) {
      return;
    }

    const sessionId = currentSession.sessionId;
    setSessionUiState((current) => beginSessionInterrupt(current, sessionId));
    setErrorText(null);

    try {
      const result = await apiClient.interruptSessionExecution(sessionId);
      setSessionUiState((current) =>
        setSessionSnapshot(current, result.session)
      );
      setSessionRegistry((current) => upsertSession(current, result.session));
    } catch (error) {
      setSessionUiState((current) =>
        rollbackSessionUiState(current, sessionId)
      );
      setErrorText(error instanceof Error ? error.message : String(error));
    }
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
        model: normalizedForm.model,
        yoloMode: normalizedForm.yoloMode,
        contextWindow: normalizeContextWindow(normalizedForm.contextWindow),
        maxTurns: normalizeMaxTurns(normalizedForm.maxTurns),
        shellAllowPatterns: splitPatternLines(
          normalizedForm.shellAllowPatterns
        ),
        shellDenyPatterns: splitPatternLines(normalizedForm.shellDenyPatterns),
        toolAllowList: normalizedForm.toolAllowList,
        toolAskList: normalizedForm.toolAskList,
        toolDenyList: normalizedForm.toolDenyList,
        enabledCapabilityPacks: normalizedForm.enabledCapabilityPacks,
        debugConversationView: normalizedForm.debugConversationView
      });
      setUserSettings(updated);
      setSettingsForm(toSettingsFormState(updated));

      if (currentSession && currentSession.context.userId === targetUserId) {
        const syncedSession = await apiClient.updateSessionSettings(
          currentSession.sessionId,
          {
            model: updated.model,
            yoloMode: updated.yoloMode,
            shellAllowPatterns: updated.shellAllowPatterns,
            shellDenyPatterns: updated.shellDenyPatterns,
            toolAllowList: updated.toolAllowList,
            toolAskList: updated.toolAskList,
            toolDenyList: updated.toolDenyList,
            enabledCapabilityPacks: updated.enabledCapabilityPacks
          }
        );
        setSessionUiState((current) =>
          setSessionSnapshot(current, syncedSession)
        );
        setSessionRegistry((current) => upsertSession(current, syncedSession));
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

  async function handleSettingsModelChange(model: string) {
    const nextForm = patchSettingsForm(settingsForm, {
      model
    });
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
  }

  async function handleSessionPlanModeChange(checked: boolean) {
    if (!currentSession || submitting) {
      return;
    }

    setErrorText(null);
    try {
      const updated = await apiClient.updateSessionSettings(
        currentSession.sessionId,
        {
          planModeEnabled: checked
        }
      );
      setSessionUiState((current) => setSessionSnapshot(current, updated));
      setSessionRegistry((current) => upsertSession(current, updated));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSettingsDebugConversationViewChange(checked: boolean) {
    const nextForm = patchSettingsForm(settingsForm, {
      debugConversationView: checked
    });
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
  }

  async function handleSettingsCapabilityPackToggle(packName: string) {
    if (savingSettings) {
      return;
    }

    const exists = settingsForm.enabledCapabilityPacks.includes(packName);
    const nextForm = patchSettingsForm(settingsForm, {
      enabledCapabilityPacks: exists
        ? settingsForm.enabledCapabilityPacks.filter(
            (item) => item !== packName
          )
        : [...settingsForm.enabledCapabilityPacks, packName]
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

  const messageProjection = useMemo(
    () =>
      buildMessageManagerProjection({
        session: currentSession,
        traceRecords,
        debugConversationView: settingsForm.debugConversationView,
        state: messageManagerState
      }),
    [
      currentSession,
      traceRecords,
      settingsForm.debugConversationView,
      messageManagerState
    ]
  );
  const {
    conversation: conversationProjection,
    inspector: inspectorProjection
  } = messageProjection;
  const {
    toolRows,
    turnUsageByTurnCount
  } = inspectorProjection;
  const todoUpdating = Boolean(
    currentSession &&
    toolRows.some(
      (row) =>
        row.output === null &&
        currentSession.sessionState.pendingToolCallIds.includes(
          row.toolCallId
        ) &&
        isTodoToolName(row.toolName)
    )
  );
  const groupedRoutines = groupRoutinesByDate(routines);
  const weekDates = currentSession
    ? buildWeekRange(currentSession.context.currentDateContext).dates
    : [];
  const pendingPermissionRequest =
    currentSession?.context.pendingPermissionRequest ?? null;
  const pendingUserQuestionPayload =
    currentSession?.context.pendingUserQuestionPayload ?? null;
  const showSidebarPanel = activeSidebarPanel !== null;
  const canInterrupt = canInterruptSessionExecution({
    session: currentSession,
    submitting,
    interruptingSessionId
  });
  const interrupting =
    (currentSession
      ? interruptingSessionId === currentSession.sessionId
      : false) || Boolean(currentSession?.sessionState.interruptRequested);
  const showInterruptedHint = Boolean(
    currentSession &&
    currentSession.sessionState.loopState === "interrupted" &&
    !currentSession.sessionState.interruptRequested &&
    !submitting
  );
  const sidebarToggleLabel = isSessionRailCollapsed
    ? "展开会话侧边栏"
    : "收起会话侧边栏";
  const sidebarToggleButton = (
    <button
      type="button"
      title={sidebarToggleLabel}
      aria-label={sidebarToggleLabel}
      onClick={() => setIsSessionRailCollapsed((current) => !current)}
      className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
    >
      {isSessionRailCollapsed ? ">>" : "<<"}
    </button>
  );

  function handleAssistantAnimationComplete(itemKey: string) {
    setMessageManagerState((current) =>
      markMessageManagerAnimationComplete(current, itemKey)
    );
  }

  useEffect(() => {
    setMessageManagerState((current) => resetMessageManagerViewState(current));
  }, [currentSession?.sessionId, settingsForm.debugConversationView]);

  useEffect(() => {
    if (conversationProjection.newlyCollapsedFlowKeys.length === 0) {
      return;
    }

    setMessageManagerState((current) =>
      registerMessageManagerCollapsedFlows(
        current,
        conversationProjection.newlyCollapsedFlowKeys
      )
    );
  }, [conversationProjection.newlyCollapsedFlowKeys]);

  return (
    <main className="min-h-screen bg-[var(--app-bg-canvas)] text-[var(--app-text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1840px] flex-col gap-5 px-4 py-4 lg:flex-row lg:items-start lg:gap-6 lg:px-6">
        {isSessionRailCollapsed ? null : (
          <SessionWorkbenchSidebar
            sessions={renderedSessions}
            selectedSessionId={selectedSessionId}
            activeSidebarPanel={activeSidebarPanel}
            collapsed={false}
            deletingSessionId={deletingSessionId}
            loading={loading}
            creatingSession={creatingSession}
            onCreateSession={handleCreateSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={(sessionId) => void handleDeleteSession(sessionId)}
            onToggleSidebarPanel={handleToggleSidebarPanel}
          />
        )}

        <div className="relative min-h-[calc(100vh-2rem)] min-w-0 flex-1 lg:h-[calc(100vh-2rem)]">
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
              inspectorProjection={inspectorProjection}
              activeTab={activeTab}
              onResetAllRoutines={() => void handleResetAllRoutines()}
              onSelectTab={setActiveTab}
              onSettingsFormChange={handleSettingsFormChange}
              onSettingsBlur={() => void handleSaveUserSettings()}
              onSettingsYoloModeChange={(checked) =>
                void handleSettingsYoloModeChange(checked)
              }
              onSettingsDebugConversationViewChange={(checked) =>
                void handleSettingsDebugConversationViewChange(checked)
              }
              onSettingsPermissionToolToggle={(toolName, target) =>
                void handleSettingsPermissionToolToggle(toolName, target)
              }
              onSettingsCapabilityPackToggle={(packName) =>
                void handleSettingsCapabilityPackToggle(packName)
              }
              headerActions={sidebarToggleButton}
            />
          ) : (
            <SessionWorkbenchConversationPanel
              currentSession={currentSession}
              todoUpdating={todoUpdating}
              loading={loading}
              conversationProjection={conversationProjection}
              turnUsageByTurnCount={turnUsageByTurnCount}
              expandedItemKeys={messageManagerState.expandedItemKeys}
              autoCollapsingItemKeys={
                messageManagerState.autoCollapsingItemKeys
              }
              debugConversationView={settingsForm.debugConversationView}
              pendingPermissionRequest={pendingPermissionRequest}
              pendingUserQuestionPayload={pendingUserQuestionPayload}
              message={message}
              submitting={submitting}
              canInterrupt={canInterrupt}
              interrupting={interrupting}
              showInterruptedHint={showInterruptedHint}
              errorText={errorText}
              modelCatalog={modelCatalog}
              selectedModelId={settingsForm.model || currentSession?.model || ""}
              onMessageChange={setMessage}
              onSubmit={(event) => void handleSubmit(event)}
              onInterrupt={() => void handleInterruptSession()}
              onSettingsModelChange={(model) =>
                void handleSettingsModelChange(model)
              }
              onSessionPlanModeChange={(checked) =>
                void handleSessionPlanModeChange(checked)
              }
              onPermissionQuickReply={(reply) =>
                void handlePermissionQuickReply(reply)
              }
              onUserQuestionQuickReply={(reply) =>
                void submitSessionMessage(reply)
              }
              onAssistantAnimationComplete={handleAssistantAnimationComplete}
              onToggleExpandedItem={(key) =>
                setMessageManagerState((current) =>
                  toggleMessageManagerExpanded(current, key)
                )
              }
              onAutoCollapseComplete={(key) =>
                setMessageManagerState((current) =>
                  completeMessageManagerAutoCollapse(current, key)
                )
              }
              headerActions={sidebarToggleButton}
            />
          )}
        </div>
      </div>
    </main>
  );
}
