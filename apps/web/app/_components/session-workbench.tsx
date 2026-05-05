"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";

import {
  createApiClient,
  type CronJobRecord,
  type CreateCronJobPayload,
  type ModelCatalogEntry,
  type RoutineRecord,
  type RunStreamEvent,
  type SessionForkTarget,
  type SessionRewriteTarget,
  type SessionSnapshot,
  type SessionWorkspaceGitStatus,
  type SettingsPermissionToolOption,
  type SessionSettingsRecord,
  type TraceRecord,
  type UserContextHookRecord,
  type UpdateCronJobPayload,
  type WorkspaceFileSearchResult,
  type WorkspaceSkillSearchResult
} from "@ai-app-template/sdk";

import {
  buildWeekRange,
  buildChannelsPayloadFromState,
  buildMcpServersFromForm,
  canInterruptSessionExecution,
  createEmptyMcpServerFormState,
  findReusableNewSessionSummary,
  groupRoutinesByDate,
  appendPatternLine,
  normalizeMaxTurns,
  normalizeSettingsFormState,
  patchSettingsForm,
  removePatternLine,
  enforceSingleEnabledUserContextHookType,
  getNextAvailableUserContextHookType,
  resolveSelectedModelId,
  resolveSelectedThinkingEffort,
  shouldPersistUserContextHookMutation,
  toSettingsMcpFormState,
  toSettingsFormState,
  toSettingsChannelsState,
  toSettingsSkillsState
} from "./session-workbench-state";
import {
  applyExtendedSettingsPayloads,
  applyUserSettingsPayload,
  refreshExtendedSettingsPayloads,
  saveUserSettingsWithRefresh
} from "./session-workbench-settings-controller";
import {
  bootstrapSessions,
  applyStreamEventToSessionRegistry,
  createSessionRegistryState,
  deriveRenderedSessions,
  hydrateSelectedSession,
  replaceSessions,
  selectSession,
  upsertSession
} from "./session-registry-manager";
import {
  buildMessageManagerProjection,
  createMessageManagerState
} from "./session-message-manager";
import {
  applyStreamEventToSessionLocalState,
  beginSessionLocalInterrupt,
  beginSessionLocalSubmission,
  clearSessionLocalState,
  completeAutoCollapseForSession,
  createSessionLocalStateMap,
  finishSessionLocalSubmission,
  getSessionLocalStateBucket,
  markAssistantAnimationCompleteForSession,
  registerCollapsedFlowsForSession,
  removeSessionLocalState,
  resetMessageManagerViewStateForSession,
  rollbackSessionLocalSubmission,
  setMessageManagerStateForSession,
  setRunFileChangesForSession,
  toggleExpandedItemForSession,
  upsertSessionLocalState
} from "./session-local-state-manager";
import {
  buildRunFileChangesStatesFromSession,
  getRunFileChangesAggregateState,
  getSelectedWorkspaceFileChanges,
  mergeRunFileChangesStates,
  type RunFileChangesState
} from "./session-run-file-changes";
import { isTodoToolName } from "./session-todo-state";
import {
  SessionWorkbenchConversationPanel,
  SessionWorkbenchDrawer,
  SessionWorkbenchSidebar
} from "./session-workbench-ui";
import { SessionWorkbenchSettings } from "./session-workbench-settings";
import {
  SESSION_RAIL_COLLAPSE_MEDIA_QUERY,
  resolveSessionRailCollapsedState
} from "./session-workbench-rail";
import {
  DEFAULT_MAX_TURNS,
  clearActiveSidebarPanel,
  createDefaultCronJobFormState,
  toCronJobFormState,
  type CronJobFormState,
  type InspectorTabId,
  type SettingsFormState,
  type SettingsChannelsState,
  type SettingsMcpFormState,
  type SettingsSkillsState,
  type SettingsPageId,
  type SidebarPanelId
} from "./session-workbench-types";

const apiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"
});

const SESSION_RAIL_COLLAPSED_STORAGE_KEY = "workbench-session-rail-collapsed";
const ACTIVE_SESSION_REFRESH_INTERVAL_MS = 3_000;
const SESSION_LIST_REFRESH_INTERVAL_MS = 5_000;
const CRON_JOB_LIST_REFRESH_INTERVAL_MS = 5_000;
const SESSION_SEARCH_DEBOUNCE_MS = 180;

export {
  buildRunFileChangesState,
  buildRunFileChangesStatesFromSession,
  collectWorkspaceFileChangesFromRun,
  getRunFileChangesAggregateState,
  getSelectedWorkspaceFileChanges,
  mergeRunFileChangesStates
} from "./session-run-file-changes";

export function shouldBootstrapFromRequestedSession(input: {
  hasHydratedSessions: boolean;
  requestedSessionId: string | null;
  selectedSessionId: string | null;
}): boolean {
  if (!input.hasHydratedSessions) {
    return true;
  }

  return input.requestedSessionId !== input.selectedSessionId;
}

export function shouldLoadExtendedSettingsForPanel(
  activeSidebarPanel: SidebarPanelId | null
): boolean {
  return activeSidebarPanel === "settings";
}

export function shouldLoadCronJobsForPanel(
  activeSidebarPanel: SidebarPanelId | null
): boolean {
  return activeSidebarPanel === "cron";
}

async function fetchSessionListSnapshots(
  query: string
): Promise<SessionSnapshot[]> {
  return query.length > 0
    ? apiClient.searchSessions(query)
    : apiClient.listSessions();
}

function inferUserContextHookBehavior(
  hook: Pick<UserContextHookRecord, "event" | "behavior">
): NonNullable<UserContextHookRecord["behavior"]> {
  return hook.behavior ?? (hook.event === "run_end" ? "message" : "context");
}

function resolvePendingPreUserHooks(input: {
  hooks: UserContextHookRecord[];
  session: SessionSnapshot | null;
}) {
  const isFirstRun = input.session?.context.firstUserMessage == null;
  const hooks = input.hooks
    .filter((hook) => hook.enabled)
    .filter((hook) => {
      const behavior = inferUserContextHookBehavior(hook);
      return (
        behavior === "message" ||
        (behavior === "subagent" &&
          (hook.waitMode ?? "blocking") === "blocking")
      );
    })
    .filter(
      (hook) =>
        hook.event === "run_started" ||
        (hook.event === "session_started" && isFirstRun)
    )
    .map((hook) => ({
      event: hook.event,
      behavior: inferUserContextHookBehavior(hook),
      title: hook.title.trim()
    }));

  if (hooks.length === 0) {
    return null;
  }

  return {
    runCount: hooks.filter((hook) => hook.behavior === "message").length,
    hooks
  };
}

export function shouldApplySessionListResponse(input: {
  requestVersion: number;
  currentVersion: number;
  mutationInFlight: boolean;
}): boolean {
  return (
    !input.mutationInFlight && input.requestVersion === input.currentVersion
  );
}

export function shouldApplySelectedSessionResponse(input: {
  expectedSessionId: string;
  currentSessionId: string | null;
  mutationInFlight: boolean;
}): boolean {
  return (
    !input.mutationInFlight &&
    input.expectedSessionId === input.currentSessionId
  );
}

export function buildSessionRouteHref(
  sessionId: string | null,
  currentHref: string
): string {
  try {
    const url = new URL(currentHref);
    url.pathname = "/";
    url.search = "";
    if (sessionId) {
      url.searchParams.set("sessionId", sessionId);
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return sessionId ? `/?sessionId=${encodeURIComponent(sessionId)}` : "/";
  }
}

export interface SessionRouteRouter {
  replace(href: string, options?: { scroll?: boolean }): void;
}

export function replaceSessionRouteUsingRouter(input: {
  router: SessionRouteRouter;
  sessionId: string | null;
  currentHref: string;
}) {
  input.router.replace(
    buildSessionRouteHref(input.sessionId, input.currentHref),
    { scroll: false }
  );
}

function extractShellApprovalPattern(reply: string): string | null {
  const prefix = "本会话允许 shell:";
  if (!reply.startsWith(prefix)) {
    return null;
  }

  const pattern = reply.slice(prefix.length).trim();
  return pattern.length > 0 ? pattern : null;
}

function appendShellAllowPattern(
  currentPatterns: string,
  nextPattern: string
): string {
  return appendPatternLine(currentPatterns, nextPattern);
}

type RefreshSelectedSessionOptions = {
  resetMessageManagerState?: boolean;
  syncSettings?: boolean;
  showLoadingSettings?: boolean;
};

export function SessionWorkbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId");
  const selectedSessionIdRef = useRef<string | null>(null);
  const backgroundRefreshInFlightRef = useRef(false);
  const sessionListRefreshVersionRef = useRef(0);
  const sessionListMutationInFlightRef = useRef(false);
  const appliedSessionSearchQueryRef = useRef("");
  const sessionLocalStateMapRef = useRef(createSessionLocalStateMap());
  const runtimeSettingsUpdatePromiseRef = useRef<Promise<boolean> | null>(null);
  // Prevent duplicate undo/reapply submissions before React state settles.
  const runFileChangeActionInFlightRef = useRef<Set<string>>(new Set());

  const [sessionRegistry, setSessionRegistry] = useState(() =>
    createSessionRegistryState()
  );
  const [sessionLocalStateMap, setSessionLocalStateMap] = useState(() =>
    createSessionLocalStateMap()
  );
  const [traceRecords, setTraceRecords] = useState<TraceRecord[]>([]);
  const [forkTargets, setForkTargets] = useState<SessionForkTarget[]>([]);
  const [rewriteTarget, setRewriteTarget] =
    useState<SessionRewriteTarget | null>(null);
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [message, setMessage] = useState("");
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [appliedSessionSearchQuery, setAppliedSessionSearchQuery] =
    useState("");
  const [activeTab, setActiveTab] = useState<InspectorTabId>("prompt");
  const [loading, setLoading] = useState(true);
  const [, setLoadingSession] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] =
    useState<SidebarPanelId | null>(null);
  const [activeSettingsPage, setActiveSettingsPage] =
    useState<SettingsPageId>("general");
  const [isSessionRailCollapsed, setIsSessionRailCollapsed] = useState(false);
  const [isSessionRailNarrowViewport, setIsSessionRailNarrowViewport] =
    useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [forkingAssistantMessageId, setForkingAssistantMessageId] = useState<
    string | null
  >(null);
  const [editingRewriteMessageId, setEditingRewriteMessageId] = useState<
    string | null
  >(null);
  const [rewriteDraft, setRewriteDraft] = useState("");
  const [recoveringRewriteTarget, setRecoveringRewriteTarget] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null
  );
  const [clearingSessionHistory, setClearingSessionHistory] = useState(false);
  const [clearHistoryErrorText, setClearHistoryErrorText] = useState<
    string | null
  >(null);
  const [resettingRoutines, setResettingRoutines] = useState(false);
  const [userSettings, setUserSettings] =
    useState<SessionSettingsRecord | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>([]);
  const [permissionTools, setPermissionTools] = useState<
    SettingsPermissionToolOption[]
  >([]);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(
    toSettingsFormState(null)
  );
  const [settingsMcpForm, setSettingsMcpForm] = useState<SettingsMcpFormState>(
    toSettingsMcpFormState(null)
  );
  const [settingsChannelsState, setSettingsChannelsState] =
    useState<SettingsChannelsState>(toSettingsChannelsState(null));
  const [settingsSkillsState, setSettingsSkillsState] =
    useState<SettingsSkillsState>(toSettingsSkillsState(null));
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingRuntimeSettings, setUpdatingRuntimeSettings] = useState(false);
  const [loadingMcpSettings, setLoadingMcpSettings] = useState(false);
  const [loadingChannelsSettings, setLoadingChannelsSettings] = useState(false);
  const [loadingSkillsSettings, setLoadingSkillsSettings] = useState(false);
  const [savingMcpSettings, setSavingMcpSettings] = useState(false);
  const [savingChannelsSettings, setSavingChannelsSettings] = useState(false);
  const [cronJobs, setCronJobs] = useState<CronJobRecord[]>([]);
  const [currentCronJobId, setCurrentCronJobId] = useState<string | null>(null);
  const [cronFormState, setCronFormState] = useState<CronJobFormState>(() =>
    createDefaultCronJobFormState()
  );
  const [loadingCronJobs, setLoadingCronJobs] = useState(false);
  const [savingCronJob, setSavingCronJob] = useState(false);
  const [deletingCronJobId, setDeletingCronJobId] = useState<string | null>(
    null
  );
  const [cronStatusText, setCronStatusText] = useState<string | null>(null);
  const [cronErrorText, setCronErrorText] = useState<string | null>(null);
  const [mcpSettingsErrorText, setMcpSettingsErrorText] = useState<
    string | null
  >(null);
  const [channelsSettingsErrorText, setChannelsSettingsErrorText] = useState<
    string | null
  >(null);
  const [workspaceGitStatus, setWorkspaceGitStatus] =
    useState<SessionWorkspaceGitStatus | null>(null);
  const [workspaceGitStatusLoading, setWorkspaceGitStatusLoading] =
    useState(false);
  const [choosingWorkingDirectory, setChoosingWorkingDirectory] =
    useState(false);
  const [pendingPermissionToolName, setPendingPermissionToolName] = useState<
    string | null
  >(null);

  const settingsControllerSync = {
    setUserSettings,
    setPermissionTools,
    setSettingsForm,
    setSettingsChannelsState,
    setSettingsMcpForm,
    setSettingsSkillsState,
    setMcpSettingsErrorText,
    setChannelsSettingsErrorText
  };
  const { sessions, selectedSessionId } = sessionRegistry;
  const currentCronJobIdRef = useRef<string | null>(null);
  const [maxTurns, setMaxTurns] = useState(String(DEFAULT_MAX_TURNS));
  const [errorText, setErrorText] = useState<string | null>(null);
  const emptyMessageManagerState = useMemo(
    () => createMessageManagerState(),
    []
  );
  const selectedSessionLocalState = getSessionLocalStateBucket(
    sessionLocalStateMap,
    selectedSessionId
  );
  const currentSession = selectedSessionLocalState?.uiState.session ?? null;
  const submitting = selectedSessionLocalState?.uiState.submitting ?? false;
  const interruptingSessionId =
    selectedSessionLocalState?.uiState.interruptingSessionId ?? null;
  const messageManagerState =
    selectedSessionLocalState?.messageManagerState ?? emptyMessageManagerState;
  const runFileChanges = selectedSessionLocalState?.runFileChanges ?? [];
  const currentCronJob = useMemo(
    () => cronJobs.find((cronJob) => cronJob.id === currentCronJobId) ?? null,
    [cronJobs, currentCronJobId]
  );
  const defaultCronWorkingDirectory =
    userSettings?.workingDirectory ??
    settingsForm.workingDirectory ??
    currentSession?.workingDirectory ??
    "";
  const defaultCronModelId =
    userSettings?.model ??
    currentSession?.model ??
    modelCatalog[0]?.id ??
    "MiniMax-M2.7";
  const forkTargetsByAssistantMessageId = useMemo(
    () =>
      new Map(
        forkTargets.map(
          (target) => [target.assistantMessageId, target] as const
        )
      ),
    [forkTargets]
  );

  function clearSessionSearch() {
    appliedSessionSearchQueryRef.current = "";
    setSessionSearchQuery("");
    setAppliedSessionSearchQuery("");
  }

  function replaceSessionRoute(sessionId: string | null) {
    if (typeof window === "undefined") {
      return;
    }

    replaceSessionRouteUsingRouter({
      router,
      sessionId,
      currentHref: window.location.href
    });
  }

  function getLocalSessionSnapshot(
    sessionId: string | null
  ): SessionSnapshot | null {
    if (!sessionId) {
      return null;
    }

    return sessionLocalStateMapRef.current[sessionId]?.uiState.session ?? null;
  }

  function setSelectedSessionIdState(sessionId: string | null) {
    selectedSessionIdRef.current = sessionId;
    setSessionRegistry((current) =>
      hydrateSelectedSession(
        selectSession(current, sessionId),
        getLocalSessionSnapshot(sessionId)
      )
    );
  }

  function resetSelectedSessionResources() {
    setForkTargets([]);
    setRewriteTarget(null);
    setTraceRecords([]);
    setRoutines([]);
    setEditingRewriteMessageId(null);
    setRewriteDraft("");
    setRecoveringRewriteTarget(false);
  }

  function hydrateCurrentSession(session: SessionSnapshot | null) {
    const selectedSessionId = selectedSessionIdRef.current;
    if (!selectedSessionId) {
      return;
    }

    if (session) {
      setSessionLocalStateMap((current) =>
        upsertSessionLocalState(current, session)
      );
      setSessionRegistry((current) => hydrateSelectedSession(current, session));
      return;
    }

    setSessionLocalStateMap((current) =>
      clearSessionLocalState(current, selectedSessionId)
    );
    setSessionRegistry((current) => hydrateSelectedSession(current, null));
  }

  function updateSelectedRunFileChanges(
    updater: (current: RunFileChangesState[]) => RunFileChangesState[]
  ) {
    const selectedSessionId = selectedSessionIdRef.current;
    if (!selectedSessionId) {
      return;
    }

    setSessionLocalStateMap((current) =>
      setRunFileChangesForSession(current, selectedSessionId, updater)
    );
  }

  function updateSelectedMessageManagerState(
    updater: Parameters<typeof setMessageManagerStateForSession>[2]
  ) {
    const selectedSessionId = selectedSessionIdRef.current;
    if (!selectedSessionId) {
      return;
    }

    setSessionLocalStateMap((current) =>
      setMessageManagerStateForSession(current, selectedSessionId, updater)
    );
  }

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    sessionLocalStateMapRef.current = sessionLocalStateMap;
  }, [sessionLocalStateMap]);

  useEffect(() => {
    currentCronJobIdRef.current = currentCronJobId;
  }, [currentCronJobId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setAppliedSessionSearchQuery(sessionSearchQuery.trim());
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAppliedSessionSearchQuery(sessionSearchQuery.trim());
    }, SESSION_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [sessionSearchQuery]);

  useEffect(() => {
    appliedSessionSearchQueryRef.current = appliedSessionSearchQuery;
  }, [appliedSessionSearchQuery]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(SESSION_RAIL_COLLAPSE_MEDIA_QUERY);
    const syncSessionRailState = () => {
      setIsSessionRailNarrowViewport(mediaQuery.matches);
      const storedValue = window.localStorage.getItem(
        SESSION_RAIL_COLLAPSED_STORAGE_KEY
      );
      setIsSessionRailCollapsed(
        resolveSessionRailCollapsedState(storedValue, mediaQuery.matches)
      );
    };

    syncSessionRailState();
    mediaQuery.addEventListener("change", syncSessionRailState);

    return () => {
      mediaQuery.removeEventListener("change", syncSessionRailState);
    };
  }, []);

  useEffect(() => {
    if (!currentSession) {
      setWorkspaceGitStatus(null);
      setWorkspaceGitStatusLoading(false);
      return undefined;
    }

    const sessionId = currentSession.sessionId;
    const workingDirectory = currentSession.workingDirectory;
    let disposed = false;

    async function loadStatus(showLoading: boolean) {
      if (showLoading) {
        setWorkspaceGitStatusLoading(true);
      }

      try {
        const status = await apiClient.getSessionWorkspaceGitStatus(sessionId);
        if (!disposed) {
          setWorkspaceGitStatus(status);
        }
      } catch {
        if (!disposed) {
          setWorkspaceGitStatus({
            workingDirectory,
            ok: false,
            code: "GIT_STATUS_FAILED",
            message: "Failed to load git status.",
            branch: null,
            clean: null,
            changedPathCount: 0,
            stagedPathCount: 0,
            unstagedPathCount: 0,
            untrackedPathCount: 0,
            addedLineCount: 0,
            removedLineCount: 0
          });
        }
      } finally {
        if (!disposed) {
          setWorkspaceGitStatusLoading(false);
        }
      }
    }

    setWorkspaceGitStatus(null);
    void loadStatus(true);
    const intervalId = window.setInterval(() => {
      void loadStatus(false);
    }, 7_000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [currentSession?.sessionId, currentSession?.workingDirectory]);

  const renderedSessions = useMemo(
    () => deriveRenderedSessions(sessionRegistry),
    [sessionRegistry]
  );

  function resetCronEditor(cronJob: CronJobRecord | null = null) {
    if (cronJob) {
      setCurrentCronJobId(cronJob.id);
      setCronFormState(toCronJobFormState(cronJob));
      return;
    }

    setCurrentCronJobId(null);
    setCronFormState(
      createDefaultCronJobFormState({
        workingDirectory: defaultCronWorkingDirectory
      })
    );
  }

  function focusConversationView() {
    setActiveSidebarPanel(clearActiveSidebarPanel());
  }

  function beginSessionListMutation() {
    sessionListMutationInFlightRef.current = true;
    sessionListRefreshVersionRef.current += 1;
  }

  function endSessionListMutation() {
    sessionListMutationInFlightRef.current = false;
    sessionListRefreshVersionRef.current += 1;
  }

  useEffect(() => {
    if (
      !shouldBootstrapFromRequestedSession({
        hasHydratedSessions: sessions.length > 0,
        requestedSessionId,
        selectedSessionId: selectedSessionIdRef.current
      })
    ) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setErrorText(null);

      try {
        const modelsResultPromise = apiClient.listModels().catch(() => null);
        const listRequestVersion = sessionListRefreshVersionRef.current;
        let snapshots = await apiClient.listSessions();
        if (
          cancelled ||
          !shouldApplySessionListResponse({
            requestVersion: listRequestVersion,
            currentVersion: sessionListRefreshVersionRef.current,
            mutationInFlight: sessionListMutationInFlightRef.current
          })
        ) {
          return;
        }
        if (!snapshots.length) {
          beginSessionListMutation();
          try {
            const created = await apiClient.createSession();
            if (cancelled) {
              return;
            }
            snapshots = [created];
          } finally {
            endSessionListMutation();
          }
        }

        const modelsResult = await modelsResultPromise;

        if (cancelled) {
          return;
        }

        if (modelsResult) {
          setModelCatalog(modelsResult.models);
        }
        const nextRegistry = bootstrapSessions(snapshots, requestedSessionId);
        selectedSessionIdRef.current = nextRegistry.selectedSessionId;
        setSessionRegistry(nextRegistry);
        if (nextRegistry.selectedSessionId) {
          replaceSessionRoute(nextRegistry.selectedSessionId);
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
      setLoadingMcpSettings(false);
      setLoadingChannelsSettings(false);
      setLoadingSkillsSettings(false);
      setErrorText(null);

      try {
        const [session, historyTargets] = await Promise.all([
          apiClient.getSession(sessionId),
          apiClient.listSessionForkTargets(sessionId)
        ]);
        if (
          cancelled ||
          !shouldApplySelectedSessionResponse({
            expectedSessionId: sessionId,
            currentSessionId: selectedSessionIdRef.current,
            mutationInFlight: sessionListMutationInFlightRef.current
          })
        ) {
          return;
        }

        hydrateCurrentSession(session);
        setMaxTurns(String(session.maxTurns));
        updateSelectedRunFileChanges((current) =>
          mergeRunFileChangesStates(
            current,
            buildRunFileChangesStatesFromSession(session)
          )
        );
        setForkTargets(historyTargets.forkTargets);
        setRewriteTarget(historyTargets.rewriteTarget);
        setLoadingSession(false);

        const week = buildWeekRange(session.context.currentDateContext);
        const [traceResult, routinesResult, settingsResult] =
          await Promise.allSettled([
            apiClient.getSessionTrace(sessionId),
            apiClient.listSessionRoutines(sessionId, {
              startDate: week.startDate,
              endDate: week.endDate
            }),
            apiClient.getUserSettingsPayload()
          ]);

        if (
          cancelled ||
          !shouldApplySelectedSessionResponse({
            expectedSessionId: sessionId,
            currentSessionId: selectedSessionIdRef.current,
            mutationInFlight: sessionListMutationInFlightRef.current
          })
        ) {
          return;
        }

        if (traceResult.status === "fulfilled") {
          setTraceRecords(traceResult.value);
        }
        if (routinesResult.status === "fulfilled") {
          setRoutines(routinesResult.value.routines);
        }
        if (settingsResult.status === "fulfilled") {
          applyUserSettingsPayload(settingsResult.value, settingsControllerSync);
        }

        const firstRejectedResult = [
          traceResult,
          routinesResult,
          settingsResult
        ].find((result) => result.status === "rejected");
        if (firstRejectedResult?.status === "rejected") {
          setErrorText(
            firstRejectedResult.reason instanceof Error
              ? firstRejectedResult.reason.message
              : String(firstRejectedResult.reason)
          );
        }
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

  useEffect(() => {
    if (!shouldLoadExtendedSettingsForPanel(activeSidebarPanel)) {
      return;
    }

    let cancelled = false;
    setLoadingMcpSettings(true);
    setLoadingChannelsSettings(true);
    setLoadingSkillsSettings(true);
    setMcpSettingsErrorText(null);
    setChannelsSettingsErrorText(null);

    void refreshExtendedSettingsPayloads(apiClient)
      .then((payloads) => {
        if (cancelled) {
          return;
        }

        applyExtendedSettingsPayloads(payloads, settingsControllerSync);
      })
      .catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : String(error);
          setMcpSettingsErrorText(message);
          setChannelsSettingsErrorText(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMcpSettings(false);
          setLoadingChannelsSettings(false);
          setLoadingSkillsSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSidebarPanel]);

  useEffect(() => {
    if (
      !shouldLoadCronJobsForPanel(activeSidebarPanel) ||
      currentCronJobIdRef.current !== null ||
      cronFormState.workingDirectory.trim().length > 0
    ) {
      return;
    }

    resetCronEditor(null);
  }, [
    activeSidebarPanel,
    cronFormState.workingDirectory,
    defaultCronWorkingDirectory
  ]);

  useEffect(() => {
    if (!shouldLoadCronJobsForPanel(activeSidebarPanel)) {
      return;
    }

    let cancelled = false;

    async function loadCronJobs(showLoading: boolean) {
      if (showLoading) {
        setLoadingCronJobs(true);
      }

      try {
        const jobs = await apiClient.listCronJobs();
        if (cancelled) {
          return;
        }

        setCronJobs(jobs);
        const selectedCronJobId = currentCronJobIdRef.current;
        if (
          selectedCronJobId &&
          !jobs.some((cronJob) => cronJob.id === selectedCronJobId)
        ) {
          resetCronEditor(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCronErrorText(
            error instanceof Error ? error.message : String(error)
          );
        }
      } finally {
        if (!cancelled && showLoading) {
          setLoadingCronJobs(false);
        }
      }
    }

    setCronErrorText(null);
    void loadCronJobs(true);
    const intervalId = window.setInterval(() => {
      void loadCronJobs(false);
    }, CRON_JOB_LIST_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeSidebarPanel]);

  async function refreshSelectedSession(
    sessionId: string,
    options: RefreshSelectedSessionOptions = {}
  ) {
    const {
      resetMessageManagerState: shouldResetMessageManagerState = true,
      syncSettings = true,
      showLoadingSettings = true
    } = options;

    if (showLoadingSettings) {
      setLoadingSettings(true);
    }

    try {
      const [session, historyTargets] = await Promise.all([
        apiClient.getSession(sessionId),
        apiClient.listSessionForkTargets(sessionId)
      ]);
      const week = buildWeekRange(session.context.currentDateContext);
      const [trace, routinesResult, settingsPayload] = await Promise.all([
        apiClient.getSessionTrace(sessionId),
        apiClient.listSessionRoutines(sessionId, {
          startDate: week.startDate,
          endDate: week.endDate
        }),
        syncSettings
          ? apiClient.getUserSettingsPayload()
          : Promise.resolve<{
              settings: SessionSettingsRecord;
              permissionTools: SettingsPermissionToolOption[];
            } | null>(null)
      ]);

      if (
        !shouldApplySelectedSessionResponse({
          expectedSessionId: sessionId,
          currentSessionId: selectedSessionIdRef.current,
          mutationInFlight: sessionListMutationInFlightRef.current
        })
      ) {
        return;
      }

      hydrateCurrentSession(session);
      setForkTargets(historyTargets.forkTargets);
      setRewriteTarget(historyTargets.rewriteTarget);
      setTraceRecords(trace);
      setRoutines(routinesResult.routines);
      if (settingsPayload) {
        applyUserSettingsPayload(settingsPayload, settingsControllerSync);
      }
      setMaxTurns(String(session.maxTurns));
      updateSelectedRunFileChanges((current) =>
        mergeRunFileChangesStates(
          current,
          buildRunFileChangesStatesFromSession(session)
        )
      );
      if (shouldResetMessageManagerState) {
        updateSelectedMessageManagerState(() => createMessageManagerState());
      }
    } finally {
      if (showLoadingSettings) {
        setLoadingSettings(false);
      }
    }
  }

  useEffect(() => {
    if (!currentSession) {
      return;
    }

    const sessionId = currentSession.sessionId;
    const intervalId = window.setInterval(() => {
      if (
        backgroundRefreshInFlightRef.current ||
        sessionListMutationInFlightRef.current ||
        selectedSessionIdRef.current !== sessionId
      ) {
        return;
      }

      backgroundRefreshInFlightRef.current = true;
      void refreshSelectedSession(sessionId, {
        resetMessageManagerState: false,
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

  useEffect(() => {
    if (loading) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (sessionListMutationInFlightRef.current) {
        return;
      }

      const requestVersion = sessionListRefreshVersionRef.current;
      void fetchSessionListSnapshots(appliedSessionSearchQuery)
        .then((snapshots) => {
          if (
            !shouldApplySessionListResponse({
              requestVersion,
              currentVersion: sessionListRefreshVersionRef.current,
              mutationInFlight: sessionListMutationInFlightRef.current
            })
          ) {
            return;
          }
          setSessionRegistry((current) => replaceSessions(current, snapshots));
        })
        .catch(() => undefined);
    }, SESSION_LIST_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appliedSessionSearchQuery, loading]);

  useEffect(() => {
    if (loading) {
      return;
    }

    let cancelled = false;
    const requestVersion = sessionListRefreshVersionRef.current + 1;
    sessionListRefreshVersionRef.current = requestVersion;

    void fetchSessionListSnapshots(appliedSessionSearchQuery)
      .then((snapshots) => {
        if (
          cancelled ||
          !shouldApplySessionListResponse({
            requestVersion,
            currentVersion: sessionListRefreshVersionRef.current,
            mutationInFlight: sessionListMutationInFlightRef.current
          })
        ) {
          return;
        }

        setSessionRegistry((current) => replaceSessions(current, snapshots));
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appliedSessionSearchQuery, loading]);

  async function createSessionNow() {
    if (creatingSession) {
      return;
    }

    const reusableSession = findReusableNewSessionSummary(sessions);
    if (reusableSession) {
      clearSessionSearch();
      setErrorText(null);
      focusConversationView();
      setSelectedSessionIdState(reusableSession.sessionId);
      replaceSessionRoute(reusableSession.sessionId);
      return;
    }

    try {
      clearSessionSearch();
      setCreatingSession(true);
      setErrorText(null);
      beginSessionListMutation();
      const session = await apiClient.createSession();
      setSelectedSessionIdState(session.sessionId);
      hydrateCurrentSession(session);
      focusConversationView();
      resetSelectedSessionResources();
      replaceSessionRoute(session.sessionId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      endSessionListMutation();
      setCreatingSession(false);
    }
  }

  async function handleCreateSession() {
    await createSessionNow();
  }

  function handleSelectSession(sessionId: string) {
    focusConversationView();
    setSelectedSessionIdState(sessionId);
    replaceSessionRoute(sessionId);
  }

  async function handleCreateFork(assistantMessageId: string) {
    if (!currentSession || forkingAssistantMessageId) {
      return;
    }

    try {
      beginSessionListMutation();
      setForkingAssistantMessageId(assistantMessageId);
      setErrorText(null);
      const forkSession = await apiClient.createSessionFork(
        currentSession.sessionId,
        { assistantMessageId }
      );
      setSelectedSessionIdState(forkSession.sessionId);
      hydrateCurrentSession(forkSession);
      resetSelectedSessionResources();
      focusConversationView();
      replaceSessionRoute(forkSession.sessionId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      endSessionListMutation();
      setForkingAssistantMessageId(null);
    }
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
      beginSessionListMutation();
      if (selectedSessionId === sessionId) {
        setSelectedSessionIdState(null);
      }
      await apiClient.deleteSession(sessionId);
      setSessionLocalStateMap((current) =>
        removeSessionLocalState(current, sessionId)
      );
      const searchQuery = appliedSessionSearchQueryRef.current;
      const useUnfilteredFallback =
        selectedSessionId === sessionId && searchQuery.length > 0;
      if (useUnfilteredFallback) {
        clearSessionSearch();
      }
      const refreshedSessions = await fetchSessionListSnapshots(
        useUnfilteredFallback ? "" : searchQuery
      );
      setSessionRegistry((current) =>
        replaceSessions(current, refreshedSessions)
      );

      if (selectedSessionId !== sessionId) {
        return;
      }

      const nextSessionId = refreshedSessions[0]?.sessionId ?? null;
      resetSelectedSessionResources();
      setSelectedSessionIdState(nextSessionId);

      if (nextSessionId) {
        replaceSessionRoute(nextSessionId);
        return;
      }

      const newSession = await apiClient.createSession();
      setSelectedSessionIdState(newSession.sessionId);
      hydrateCurrentSession(newSession);
      replaceSessionRoute(newSession.sessionId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      endSessionListMutation();
      setDeletingSessionId(null);
    }
  }

  async function handleClearSessionHistory() {
    if (clearingSessionHistory || !currentSession) {
      return;
    }

    const confirmed = window.confirm(
      "这会删除所有会话记录并重新开始，确认继续吗？"
    );
    if (!confirmed) {
      return;
    }

    setClearingSessionHistory(true);
    setClearHistoryErrorText(null);
    setErrorText(null);

    try {
      beginSessionListMutation();
      setSelectedSessionIdState(null);
      clearSessionSearch();
      await apiClient.clearSessionHistory();
      setSessionRegistry(createSessionRegistryState());
      setSessionLocalStateMap(createSessionLocalStateMap());
      hydrateCurrentSession(null);
      resetSelectedSessionResources();
      focusConversationView();
      const newSession = await apiClient.createSession();
      setSelectedSessionIdState(newSession.sessionId);
      hydrateCurrentSession(newSession);
      replaceSessionRoute(newSession.sessionId);
    } catch (error) {
      const nextErrorText =
        error instanceof Error ? error.message : String(error);
      setClearHistoryErrorText(nextErrorText);
      setErrorText(nextErrorText);
    } finally {
      endSessionListMutation();
      setClearingSessionHistory(false);
    }
  }

  function handleStartRewrite(
    block: Extract<SessionSnapshot["messages"][number], { kind: "user" }>
  ) {
    if (
      !rewriteTarget ||
      rewriteTarget.userMessageId !== block.id ||
      recoveringRewriteTarget
    ) {
      return;
    }

    setEditingRewriteMessageId(block.id);
    setRewriteDraft(block.content);
    setErrorText(null);
  }

  function handleCancelRewrite() {
    if (recoveringRewriteTarget) {
      return;
    }

    setEditingRewriteMessageId(null);
    setRewriteDraft("");
  }

  async function submitSessionMessage(
    nextMessage: string,
    options?: {
      permissionReply?: boolean;
      sessionOverride?: SessionSnapshot | null;
    }
  ) {
    const activeSession = options?.sessionOverride ?? currentSession;
    const activeSessionSubmitting = activeSession
      ? (sessionLocalStateMapRef.current[activeSession.sessionId]?.uiState
          .submitting ?? false)
      : false;
    if (
      !activeSession ||
      !nextMessage.trim() ||
      activeSessionSubmitting ||
      recoveringRewriteTarget
    ) {
      return;
    }

    const sessionId = activeSession.sessionId;
    const nextMaxTurns = normalizeMaxTurns(maxTurns);
    const pendingPreUserHooks =
      options?.permissionReply === true
        ? null
        : resolvePendingPreUserHooks({
            hooks: settingsForm.userContextHooks,
            session: activeSession
          });

    setMaxTurns(String(nextMaxTurns));
    const pendingUserMessage = {
      createdAt: new Date().toISOString(),
      text: nextMessage
    };
    setSessionLocalStateMap((current) =>
      beginSessionLocalSubmission({
        map: current,
        session: {
          ...activeSession,
          maxTurns: nextMaxTurns
        },
        pendingUserMessage,
        pendingPreUserHooks,
        ...(typeof options?.permissionReply === "boolean"
          ? { permissionReply: options.permissionReply }
          : {})
      })
    );
    setMessage("");
    setActiveTab("prompt");
    setErrorText(null);
    setEditingRewriteMessageId(null);
    setRewriteDraft("");

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
          const applyStreamEvent = () => {
            let streamedSessionSnapshot: SessionSnapshot | null = null;
            setSessionLocalStateMap((current) => {
              const next = applyStreamEventToSessionLocalState(
                current,
                runEvent
              );
              streamedSessionSnapshot =
                next[runEvent.sessionId]?.uiState.session ?? null;
              return next;
            });
            const terminalSession =
              (runEvent.kind === "run_complete" ||
                runEvent.kind === "run_error") &&
              "session" in runEvent
                ? runEvent.session
                : null;
            const sessionForRegistry =
              terminalSession ?? streamedSessionSnapshot;
            if (sessionForRegistry) {
              setSessionRegistry((current) =>
                upsertSession(current, sessionForRegistry)
              );
            } else if (isActiveSession) {
              setSessionRegistry((current) =>
                applyStreamEventToSessionRegistry(current, runEvent)
              );
            }
          };

          if (
            isActiveSession &&
            (runEvent.kind === "assistant_text" || runEvent.kind === "thinking")
          ) {
            flushSync(applyStreamEvent);
            return;
          }

          applyStreamEvent();
        }
      });

      if (isActiveStreamSession()) {
        await refreshSelectedSession(sessionId);
      }
    } catch (error) {
      setSessionLocalStateMap((current) =>
        rollbackSessionLocalSubmission(current, sessionId)
      );
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionLocalStateMap((current) =>
        finishSessionLocalSubmission(current, sessionId)
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitSessionMessage(message.trim());
  }

  async function handleSubmitRewrite() {
    if (
      !currentSession ||
      !rewriteTarget ||
      editingRewriteMessageId !== rewriteTarget.userMessageId ||
      !rewriteDraft.trim()
    ) {
      return;
    }

    const nextMessage = rewriteDraft.trim();
    setRecoveringRewriteTarget(true);
    setErrorText(null);

    try {
      const settingsReady = await waitForRuntimeSettingsUpdate();
      if (!settingsReady) {
        return;
      }

      const recovered = await apiClient.recoverRewriteTarget(
        currentSession.sessionId,
        {
          checkpointId: rewriteTarget.checkpointId,
          userMessageId: rewriteTarget.userMessageId
        }
      );
      hydrateCurrentSession(recovered.session);
      setForkTargets(recovered.forkTargets);
      setRewriteTarget(recovered.rewriteTarget);
      setTraceRecords(recovered.traceRecords);
      updateSelectedRunFileChanges((current) =>
        mergeRunFileChangesStates(
          current,
          buildRunFileChangesStatesFromSession(recovered.session)
        )
      );
      updateSelectedMessageManagerState(() => createMessageManagerState());
      setEditingRewriteMessageId(null);
      setRewriteDraft("");
      await submitSessionMessage(nextMessage, {
        sessionOverride: recovered.session
      });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setRecoveringRewriteTarget(false);
    }
  }

  async function handlePermissionQuickReply(
    reply: string,
    options?: { persistShellApproval?: boolean }
  ) {
    if (options?.persistShellApproval) {
      const shellPattern = extractShellApprovalPattern(reply);
      if (shellPattern) {
        const nextForm = patchSettingsForm(settingsForm, {
          shellAllowPatterns: appendShellAllowPattern(
            settingsForm.shellAllowPatterns,
            shellPattern
          )
        });
        const saved = await handleSaveUserSettings(nextForm);
        if (!saved) {
          return;
        }
      }
    }

    await submitSessionMessage(reply, { permissionReply: true });
  }

  async function handleInterruptSession() {
    if (!currentSession) {
      return;
    }

    const sessionId = currentSession.sessionId;
    setErrorText(null);

    setSessionLocalStateMap((current) =>
      beginSessionLocalInterrupt(current, sessionId)
    );

    try {
      const result = await apiClient.interruptSessionExecution(sessionId);
      hydrateCurrentSession(result.session);
      if (result.session.sessionState.loopState === "interrupted") {
        setSessionLocalStateMap((current) =>
          finishSessionLocalSubmission(current, sessionId)
        );
      }
    } catch (error) {
      setSessionLocalStateMap((current) =>
        rollbackSessionLocalSubmission(current, sessionId)
      );
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRunFileChangeAction(
    viewKey: string,
    action: "undo" | "reapply"
  ) {
    const targetView = runFileChanges.find((view) => view.key === viewKey);
    if (
      !currentSession ||
      !targetView ||
      targetView.pendingAction ||
      runFileChangeActionInFlightRef.current.has(viewKey)
    ) {
      return;
    }

    const selectedFileIndexes = targetView.selectedFileIndexes.filter(
      (index) => index >= 0 && index < targetView.files.length
    );
    const selectedFiles = getSelectedWorkspaceFileChanges(targetView);
    if (selectedFiles.length === 0) {
      updateSelectedRunFileChanges((current) =>
        current.map((view) =>
          view.key === viewKey
            ? {
                ...view,
                errorText: "至少选择一个文件。"
              }
            : view
        )
      );
      return;
    }

    updateSelectedRunFileChanges((current) =>
      current.map((view) =>
        view.key === viewKey
          ? {
              ...view,
              pendingAction: action,
              errorText: null
            }
          : view
      )
    );
    runFileChangeActionInFlightRef.current.add(viewKey);

    try {
      await apiClient.applySessionFileChangeAction({
        sessionId: currentSession.sessionId,
        action,
        files: selectedFiles
      });
      updateSelectedRunFileChanges((current) =>
        current.map((view) =>
          view.key === viewKey
            ? (() => {
                const selectedIndexes = new Set(selectedFileIndexes);
                const nextFileStates = view.fileStates.map(
                  (fileState, index) =>
                    selectedIndexes.has(index)
                      ? action === "undo"
                        ? "undone"
                        : "applied"
                      : fileState
                );
                return {
                  ...view,
                  fileStates: nextFileStates,
                  state: getRunFileChangesAggregateState(nextFileStates),
                  pendingAction: null,
                  errorText: null
                };
              })()
            : view
        )
      );
    } catch (error) {
      updateSelectedRunFileChanges((current) =>
        current.map((view) =>
          view.key === viewKey
            ? {
                ...view,
                pendingAction: null,
                errorText:
                  error instanceof Error ? error.message : String(error)
              }
            : view
        )
      );
    } finally {
      runFileChangeActionInFlightRef.current.delete(viewKey);
    }
  }

  function handleRunFileSelectionChange(
    viewKey: string,
    selectedFileIndexes: number[]
  ) {
    updateSelectedRunFileChanges((current) =>
      current.map((view) =>
        view.key === viewKey
          ? {
              ...view,
              selectedFileIndexes
            }
          : view
      )
    );
  }

  async function handleSaveUserSettings(
    nextForm: SettingsFormState = settingsForm
  ): Promise<boolean> {
    if (savingSettings) {
      return false;
    }

    const normalizedForm = normalizeSettingsFormState(nextForm);

    setSavingSettings(true);
    setErrorText(null);
    setSettingsForm(normalizedForm);

    try {
      await saveUserSettingsWithRefresh({
        apiClient,
        form: normalizedForm,
        currentSession,
        sync: settingsControllerSync,
        hydrateCurrentSession
      });
      return true;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSavingSettings(false);
    }
  }

  function handleSettingsFormChange(patch: Partial<SettingsFormState>) {
    setSettingsForm((current) => patchSettingsForm(current, patch));
  }

  async function trackRuntimeSettingsUpdate(
    updatePromise: Promise<boolean>
  ): Promise<boolean> {
    runtimeSettingsUpdatePromiseRef.current = updatePromise;
    setUpdatingRuntimeSettings(true);
    try {
      return await updatePromise;
    } finally {
      if (runtimeSettingsUpdatePromiseRef.current === updatePromise) {
        runtimeSettingsUpdatePromiseRef.current = null;
        setUpdatingRuntimeSettings(false);
      }
    }
  }

  async function waitForRuntimeSettingsUpdate(): Promise<boolean> {
    const pendingUpdate = runtimeSettingsUpdatePromiseRef.current;
    if (!pendingUpdate) {
      return true;
    }

    return pendingUpdate;
  }

  async function handleSettingsShellAllowPatternRemove(pattern: string) {
    if (savingSettings) {
      return;
    }

    const nextForm = patchSettingsForm(settingsForm, {
      shellAllowPatterns: removePatternLine(
        settingsForm.shellAllowPatterns,
        pattern
      )
    });
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
  }

  function handleTelegramChannelChange(
    patch: Partial<SettingsChannelsState["telegram"]>
  ) {
    setSettingsChannelsState((current) => ({
      ...current,
      telegram: {
        ...current.telegram,
        ...patch
      }
    }));
  }

  async function handleTelegramChannelEnabledChange(enabled: boolean) {
    if (savingChannelsSettings) {
      return;
    }

    const nextState = {
      ...settingsChannelsState,
      telegram: {
        ...settingsChannelsState.telegram,
        enabled
      }
    };
    setSettingsChannelsState(nextState);
    await handleSaveChannelSettings(nextState);
  }

  async function handleSaveChannelSettings(
    nextState: SettingsChannelsState = settingsChannelsState
  ): Promise<boolean> {
    if (savingChannelsSettings) {
      return false;
    }

    setSavingChannelsSettings(true);
    setChannelsSettingsErrorText(null);

    try {
      const payload = await apiClient.updateUserSettingsChannels(
        buildChannelsPayloadFromState(nextState)
      );
      setSettingsChannelsState(toSettingsChannelsState(payload));
      return true;
    } catch (error) {
      setChannelsSettingsErrorText(
        error instanceof Error ? error.message : String(error)
      );
      return false;
    } finally {
      setSavingChannelsSettings(false);
    }
  }

  function handleAddMcpServer() {
    if (savingMcpSettings) {
      return;
    }

    setSettingsMcpForm((current) => ({
      ...current,
      servers: [...current.servers, createEmptyMcpServerFormState()]
    }));
  }

  function handleMcpServerChange(
    serverId: string,
    patch: Partial<SettingsMcpFormState["servers"][number]>
  ) {
    setSettingsMcpForm((current) => ({
      ...current,
      servers: current.servers.map((server) =>
        server.id === serverId ? { ...server, ...patch } : server
      )
    }));
  }

  function handleMcpServerTransportChange(
    serverId: string,
    transport: SettingsMcpFormState["servers"][number]["transport"]
  ) {
    setSettingsMcpForm((current) => ({
      ...current,
      servers: current.servers.map((server) =>
        server.id === serverId ? { ...server, transport } : server
      )
    }));
  }

  async function handleMcpServerEnabledChange(
    serverId: string,
    enabled: boolean
  ) {
    if (savingMcpSettings) {
      return;
    }

    const nextForm = {
      ...settingsMcpForm,
      servers: settingsMcpForm.servers.map((server) =>
        server.id === serverId ? { ...server, enabled } : server
      )
    };
    setSettingsMcpForm(nextForm);
    await handleSaveMcpSettings(nextForm);
  }

  async function handleMcpToolEnabledChange(
    serverId: string,
    toolName: string,
    enabled: boolean
  ) {
    if (savingMcpSettings) {
      return;
    }

    const nextForm = {
      ...settingsMcpForm,
      servers: settingsMcpForm.servers.map((server) => {
        if (server.id !== serverId) {
          return server;
        }

        const disabledTools = enabled
          ? server.disabledTools.filter((name) => name !== toolName)
          : Array.from(new Set([...server.disabledTools, toolName]));
        return {
          ...server,
          disabledTools,
          tools: server.tools.map((tool) =>
            tool.name === toolName ? { ...tool, enabled } : tool
          )
        };
      })
    };
    setSettingsMcpForm(nextForm);
    await handleSaveMcpSettings(nextForm);
  }

  async function handleDeleteMcpServer(serverId: string) {
    if (savingMcpSettings) {
      return;
    }

    const nextForm = {
      ...settingsMcpForm,
      servers: settingsMcpForm.servers.filter(
        (server) => server.id !== serverId
      )
    };
    setSettingsMcpForm(nextForm);
    await handleSaveMcpSettings(nextForm);
  }

  async function handleSaveMcpSettings(
    nextForm: SettingsMcpFormState = settingsMcpForm
  ): Promise<boolean> {
    if (savingMcpSettings) {
      return false;
    }

    setSavingMcpSettings(true);
    setMcpSettingsErrorText(null);

    try {
      const payload = await apiClient.updateUserSettingsMcp({
        servers: buildMcpServersFromForm(nextForm)
      });
      setSettingsMcpForm(toSettingsMcpFormState(payload));
      return true;
    } catch (error) {
      setMcpSettingsErrorText(
        error instanceof Error ? error.message : String(error)
      );
      return false;
    } finally {
      setSavingMcpSettings(false);
    }
  }

  function updateUserContextHookList(
    updater: (
      hooks: SettingsFormState["userContextHooks"]
    ) => SettingsFormState["userContextHooks"]
  ): SettingsFormState {
    return patchSettingsForm(settingsForm, {
      userContextHooks: updater(settingsForm.userContextHooks)
    });
  }

  async function maybeSaveUserContextHookForm(
    currentForm: SettingsFormState,
    nextForm: SettingsFormState,
    hookId: string
  ) {
    setSettingsForm(nextForm);
    if (
      !shouldPersistUserContextHookMutation({
        currentForm,
        nextForm,
        hookId
      })
    ) {
      return;
    }
    await handleSaveUserSettings(nextForm);
  }

  function handleAddUserContextHook() {
    if (savingSettings) {
      return;
    }

    setSettingsForm((current) => {
      const hookType = getNextAvailableUserContextHookType(
        current.userContextHooks
      );
      if (!hookType) {
        return current;
      }

      return patchSettingsForm(current, {
        userContextHooks: [
          ...current.userContextHooks,
          {
            id: crypto.randomUUID(),
            behavior: hookType.behavior,
            event: hookType.event,
            ...(hookType.behavior === "subagent"
              ? {
                  waitMode: "blocking" as const,
                  maxTurns: DEFAULT_MAX_TURNS
                }
              : {}),
            title: "",
            content: "",
            enabled: true
          }
        ]
      });
    });
  }

  function handleUserContextHookChange(
    hookId: string,
    patch: Partial<SettingsFormState["userContextHooks"][number]>
  ) {
    setSettingsForm((current) =>
      patchSettingsForm(current, {
        userContextHooks: current.userContextHooks.map((hook) =>
          hook.id === hookId ? { ...hook, ...patch } : hook
        )
      })
    );
  }

  async function handleUserContextHookEnabledChange(
    hookId: string,
    enabled: boolean
  ) {
    if (savingSettings) {
      return;
    }

    const nextForm = updateUserContextHookList((hooks) =>
      enforceSingleEnabledUserContextHookType(
        hooks.map((hook) => (hook.id === hookId ? { ...hook, enabled } : hook)),
        enabled ? hookId : undefined
      )
    );
    await maybeSaveUserContextHookForm(settingsForm, nextForm, hookId);
  }

  async function handleUserContextHookEventChange(
    hookId: string,
    event: SettingsFormState["userContextHooks"][number]["event"]
  ) {
    if (savingSettings) {
      return;
    }

    const nextForm = updateUserContextHookList((hooks) =>
      enforceSingleEnabledUserContextHookType(
        hooks.map((hook) =>
          hook.id === hookId
            ? {
                ...hook,
                event,
                ...(inferUserContextHookBehavior(hook) === "subagent" &&
                event === "run_end"
                  ? { waitMode: "unblocking" as const }
                  : {})
              }
            : hook
        ),
        hookId
      )
    );
    await maybeSaveUserContextHookForm(settingsForm, nextForm, hookId);
  }

  async function handleUserContextHookBehaviorChange(
    hookId: string,
    behavior: NonNullable<
      SettingsFormState["userContextHooks"][number]["behavior"]
    >
  ) {
    if (savingSettings) {
      return;
    }

    const nextForm = updateUserContextHookList((hooks) =>
      enforceSingleEnabledUserContextHookType(
        hooks.map((hook) =>
          hook.id === hookId
            ? {
                ...hook,
                behavior,
                ...(behavior === "subagent"
                  ? {
                      waitMode:
                        hook.event === "run_end"
                          ? ("unblocking" as const)
                          : (hook.waitMode ?? "blocking"),
                      maxTurns: hook.maxTurns ?? DEFAULT_MAX_TURNS
                    }
                  : {}),
                ...(behavior === "context" && hook.event === "run_end"
                  ? { event: "run_started" as const }
                  : {})
              }
            : hook
        ),
        hookId
      )
    );
    await maybeSaveUserContextHookForm(settingsForm, nextForm, hookId);
  }

  async function handleUserContextHookWaitModeChange(
    hookId: string,
    waitMode: NonNullable<
      SettingsFormState["userContextHooks"][number]["waitMode"]
    >
  ) {
    if (savingSettings) {
      return;
    }

    const nextForm = updateUserContextHookList((hooks) =>
      hooks.map((hook) => (hook.id === hookId ? { ...hook, waitMode } : hook))
    );
    await maybeSaveUserContextHookForm(settingsForm, nextForm, hookId);
  }

  async function handleDeleteUserContextHook(hookId: string) {
    if (savingSettings) {
      return;
    }

    const nextForm = updateUserContextHookList((hooks) =>
      hooks.filter((hook) => hook.id !== hookId)
    );
    await maybeSaveUserContextHookForm(settingsForm, nextForm, hookId);
  }

  async function handleMoveUserContextHook(
    hookId: string,
    direction: "up" | "down"
  ) {
    if (savingSettings) {
      return;
    }

    const nextForm = updateUserContextHookList((hooks) => {
      const currentIndex = hooks.findIndex((hook) => hook.id === hookId);
      if (currentIndex === -1) {
        return hooks;
      }

      const targetIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= hooks.length) {
        return hooks;
      }

      const nextHooks = [...hooks];
      const [moved] = nextHooks.splice(currentIndex, 1);
      if (!moved) {
        return hooks;
      }
      nextHooks.splice(targetIndex, 0, moved);
      return nextHooks;
    });
    await maybeSaveUserContextHookForm(settingsForm, nextForm, hookId);
  }

  async function handleChooseWorkingDirectory() {
    if (choosingWorkingDirectory || savingSettings) {
      return;
    }

    setChoosingWorkingDirectory(true);
    setErrorText(null);

    try {
      const startDirectory =
        settingsForm.workingDirectory ||
        userSettings?.workingDirectory ||
        currentSession?.workingDirectory;
      const selection = await apiClient.chooseDirectory({
        ...(startDirectory ? { startDirectory } : {})
      });
      if (selection.canceled || !selection.path) {
        return;
      }

      const nextForm = normalizeSettingsFormState(
        patchSettingsForm(settingsForm, {
          workingDirectory: selection.path
        })
      );
      setSettingsForm(nextForm);
      await handleSaveUserSettings(nextForm);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosingWorkingDirectory(false);
    }
  }

  async function handleSettingsPermissionToolToggle(
    toolName: string,
    target: "allow" | "ask" | "deny"
  ) {
    if (savingSettings || settingsForm.yoloMode) {
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
    if (panelId === "inspector" && !settingsForm.debugConversationView) {
      return;
    }

    setActiveSidebarPanel((current) => {
      if (current === panelId) {
        return null;
      }
      if (panelId === "settings") {
        setActiveSettingsPage("general");
      }
      return panelId;
    });
  }

  function handleCreateCronJob() {
    setCronStatusText(null);
    setCronErrorText(null);
    resetCronEditor(null);
    setActiveSidebarPanel("cron-create");
  }

  function handleSelectCronJob(cronJob: CronJobRecord) {
    setCronStatusText(null);
    setCronErrorText(null);
    resetCronEditor(cronJob);
    setActiveSidebarPanel("cron-create");
  }

  function handleCronFormChange(patch: Partial<CronJobFormState>) {
    setCronFormState((current) => ({
      ...current,
      ...patch
    }));
  }

  async function refreshCronJobsAfterMutation(selectedCronJobId: string | null) {
    const jobs = await apiClient.listCronJobs();
    setCronJobs(jobs);
    if (!selectedCronJobId) {
      return;
    }
    const nextSelected = jobs.find(
      (cronJob) => cronJob.id === selectedCronJobId
    );
    if (nextSelected) {
      resetCronEditor(nextSelected);
      return;
    }
    resetCronEditor(null);
  }

  async function handleSaveCronJob(
    payload: CreateCronJobPayload | UpdateCronJobPayload
  ) {
    if (savingCronJob) {
      return;
    }

    setSavingCronJob(true);
    setCronErrorText(null);
    setCronStatusText(null);

    try {
      const savedCronJob = currentCronJob
        ? await apiClient.updateCronJob(currentCronJob.id, payload)
        : await apiClient.createCronJob(payload as CreateCronJobPayload);
      await refreshCronJobsAfterMutation(savedCronJob.id);
      setCronStatusText(
        currentCronJob ? "已保存定时任务。" : "已创建定时任务。"
      );
      setActiveSidebarPanel("cron");
    } catch (error) {
      setCronErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingCronJob(false);
    }
  }

  async function handleToggleCronJobStatus(cronJob: CronJobRecord) {
    if (savingCronJob) {
      return;
    }

    setSavingCronJob(true);
    setCronErrorText(null);
    setCronStatusText(null);

    const nextStatus =
      cronJob.status === "active"
        ? "paused"
        : cronJob.status === "completed"
          ? "active"
          : "active";

    try {
      await apiClient.updateCronJob(cronJob.id, {
        status: nextStatus
      });
      await refreshCronJobsAfterMutation(cronJob.id);
      setCronStatusText(
        nextStatus === "active" ? "已启用定时任务。" : "已暂停定时任务。"
      );
    } catch (error) {
      setCronErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingCronJob(false);
    }
  }

  async function handleDeleteCronJob(cronJobId: string) {
    if (deletingCronJobId) {
      return;
    }

    const confirmed = window.confirm(
      "删除后不会再触发这个定时任务，确认继续吗？"
    );
    if (!confirmed) {
      return;
    }

    setDeletingCronJobId(cronJobId);
    setCronErrorText(null);
    setCronStatusText(null);

    try {
      await apiClient.deleteCronJob(cronJobId);
      const nextSelectedCronJobId =
        currentCronJobIdRef.current === cronJobId
          ? null
          : currentCronJobIdRef.current;
      await refreshCronJobsAfterMutation(nextSelectedCronJobId);
      setCronStatusText("已删除定时任务。");
    } catch (error) {
      setCronErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingCronJobId(null);
    }
  }

  function handleJumpToCronRun(sessionId: string) {
    focusConversationView();
    setSelectedSessionIdState(sessionId);
    replaceSessionRoute(sessionId);
  }

  async function handleChooseCronWorkingDirectory() {
    if (choosingWorkingDirectory || savingCronJob) {
      return;
    }

    setChoosingWorkingDirectory(true);
    setCronErrorText(null);

    try {
      const startDirectory =
        cronFormState.workingDirectory || defaultCronWorkingDirectory;
      const selection = await apiClient.chooseDirectory(
        startDirectory ? { startDirectory } : {}
      );
      if (selection.canceled || !selection.path) {
        return;
      }

      setCronFormState((current) => ({
        ...current,
        workingDirectory: selection.path ?? current.workingDirectory
      }));
    } catch (error) {
      setCronErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosingWorkingDirectory(false);
    }
  }

  async function handleSettingsYoloModeChange(checked: boolean) {
    const nextForm = patchSettingsForm(settingsForm, {
      yoloMode: checked
    });
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
  }

  async function handleSettingsModelChange(model: string) {
    if (!currentSession) {
      return;
    }

    setErrorText(null);

    await trackRuntimeSettingsUpdate(
      (async () => {
        try {
          const updatedSession = await apiClient.updateSessionSettings(
            currentSession.sessionId,
            {
              model
            }
          );
          hydrateCurrentSession(updatedSession);

          const settingsPayload = await apiClient.updateUserSettingsPayload(
            { model }
          );
          applyUserSettingsPayload(settingsPayload, settingsControllerSync);
          return true;
        } catch (error) {
          setErrorText(error instanceof Error ? error.message : String(error));
          return false;
        }
      })()
    );
  }

  async function handleSettingsThinkingEffortChange(thinkingEffort: string) {
    if (!currentSession) {
      return;
    }

    const normalizedThinkingEffort = thinkingEffort === "max" ? "max" : "high";
    setErrorText(null);

    await trackRuntimeSettingsUpdate(
      (async () => {
        try {
          const updatedSession = await apiClient.updateSessionSettings(
            currentSession.sessionId,
            {
              thinkingEffort: normalizedThinkingEffort
            }
          );
          hydrateCurrentSession(updatedSession);

          const settingsPayload = await apiClient.updateUserSettingsPayload(
            { thinkingEffort: normalizedThinkingEffort }
          );
          applyUserSettingsPayload(settingsPayload, settingsControllerSync);
          return true;
        } catch (error) {
          setErrorText(error instanceof Error ? error.message : String(error));
          return false;
        }
      })()
    );
  }

  async function handleSessionPlanModeChange(checked: boolean) {
    if (!currentSession || submitting) {
      return false;
    }

    setErrorText(null);
    try {
      const updated = await apiClient.updateSessionSettings(
        currentSession.sessionId,
        {
          planModeEnabled: checked
        }
      );
      hydrateCurrentSession(updated);
      return true;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function handleSearchSessionWorkspaceFiles(
    query: string,
    limit: number
  ): Promise<WorkspaceFileSearchResult> {
    if (!currentSession) {
      return {
        items: [],
        truncated: false
      };
    }

    return apiClient.searchSessionWorkspaceFiles(currentSession.sessionId, {
      query,
      limit
    });
  }

  async function handleSearchSessionSkills(
    query: string,
    limit: number
  ): Promise<WorkspaceSkillSearchResult> {
    if (!currentSession) {
      return {
        items: [],
        truncated: false
      };
    }

    return apiClient.searchSessionSkills(currentSession.sessionId, {
      query,
      limit
    });
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

  async function handleSettingsSkillEnabledChange(
    skillName: string,
    enabled: boolean
  ) {
    if (savingSettings) {
      return;
    }

    const nextForm = patchSettingsForm(settingsForm, {
      workspaceSkillSettings: [
        ...settingsForm.workspaceSkillSettings.filter(
          (setting) => setting.skillName !== skillName
        ),
        {
          skillName,
          enabled
        }
      ]
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

  const settingsMeta = loadingSettings
    ? "syncing"
    : savingSettings
      ? "autosaving"
      : userSettings
        ? "已加载"
        : "--";

  const settingsStatusText = savingSettings
    ? "正在自动保存..."
    : loadingSettings
      ? "正在同步默认设置..."
      : userSettings
        ? "修改后会自动保存，并用于后续新建会话"
        : "设置尚未加载";

  const messageProjection = useMemo(
    () =>
      buildMessageManagerProjection({
        session: currentSession,
        traceRecords,
        debugConversationView: settingsForm.debugConversationView,
        state: messageManagerState,
        userContextHooks: settingsForm.userContextHooks
      }),
    [
      currentSession,
      traceRecords,
      settingsForm.debugConversationView,
      settingsForm.userContextHooks,
      messageManagerState
    ]
  );
  const {
    conversation: conversationProjection,
    inspector: inspectorProjection
  } = messageProjection;
  const { toolRows, turnUsageByTurnCount } = inspectorProjection;
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
  const pendingConfirmationPayload =
    currentSession?.context.pendingConfirmationPayload ?? null;
  const pendingUserQuestionPayload =
    currentSession?.context.pendingUserQuestionPayload ?? null;
  const isSettingsMode = activeSidebarPanel === "settings";
  const showSidebarPanel =
    activeSidebarPanel !== null && activeSidebarPanel !== "settings";
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
  const showSessionRail = !isSessionRailCollapsed;
  const showSessionRailOverlay = showSessionRail && isSessionRailNarrowViewport;
  const handleOverlaySelectSession = (sessionId: string) => {
    handleSelectSession(sessionId);
    setIsSessionRailCollapsed(true);
  };
  const handleOverlayCreateSession = () => {
    setIsSessionRailCollapsed(true);
    void handleCreateSession();
  };
  const sidebarToggleLabel = isSessionRailCollapsed
    ? "展开会话侧边栏"
    : "收起会话侧边栏";
  const sidebarToggleButton = (
    <button
      type="button"
      title={sidebarToggleLabel}
      aria-label={sidebarToggleLabel}
      onClick={() =>
        setIsSessionRailCollapsed((current) => {
          const nextValue = !current;
          window.localStorage.setItem(
            SESSION_RAIL_COLLAPSED_STORAGE_KEY,
            String(nextValue)
          );
          return nextValue;
        })
      }
      className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
    >
      {isSessionRailCollapsed ? ">>" : "<<"}
    </button>
  );
  const headerActions = <>{sidebarToggleButton}</>;

  function handleAssistantAnimationComplete(itemKey: string) {
    const selectedSessionId = selectedSessionIdRef.current;
    if (!selectedSessionId) {
      return;
    }

    setSessionLocalStateMap((current) =>
      markAssistantAnimationCompleteForSession(
        current,
        selectedSessionId,
        itemKey
      )
    );
  }

  useEffect(() => {
    const selectedSessionId = selectedSessionIdRef.current;
    if (!selectedSessionId) {
      return;
    }

    setSessionLocalStateMap((current) =>
      resetMessageManagerViewStateForSession(current, selectedSessionId)
    );
  }, [currentSession?.sessionId, settingsForm.debugConversationView]);

  useEffect(() => {
    if (
      settingsForm.debugConversationView ||
      activeSidebarPanel !== "inspector"
    ) {
      return;
    }

    setActiveSidebarPanel(null);
  }, [activeSidebarPanel, settingsForm.debugConversationView]);

  useEffect(() => {
    if (conversationProjection.newlyCollapsedFlowKeys.length === 0) {
      return;
    }

    const selectedSessionId = selectedSessionIdRef.current;
    if (!selectedSessionId) {
      return;
    }

    setSessionLocalStateMap((current) =>
      registerCollapsedFlowsForSession(
        current,
        selectedSessionId,
        conversationProjection.newlyCollapsedFlowKeys
      )
    );
  }, [conversationProjection.newlyCollapsedFlowKeys]);

  return (
    <main className="min-h-screen bg-[var(--app-bg-canvas)] text-[var(--app-text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1840px] flex-col gap-5 px-4 py-4 lg:flex-row lg:items-start lg:gap-6 lg:px-6">
        {showSessionRail && !showSessionRailOverlay && !isSettingsMode ? (
          <SessionWorkbenchSidebar
            sessions={renderedSessions}
            selectedSessionId={selectedSessionId}
            debugConversationView={settingsForm.debugConversationView}
            searchValue={sessionSearchQuery}
            activeSidebarPanel={activeSidebarPanel}
            collapsed={false}
            deletingSessionId={deletingSessionId}
            loading={loading}
            creatingSession={creatingSession}
            onCreateSession={() => void handleCreateSession()}
            onSearchValueChange={setSessionSearchQuery}
            onSelectSession={handleSelectSession}
            onDeleteSession={(sessionId) => void handleDeleteSession(sessionId)}
            onToggleSidebarPanel={handleToggleSidebarPanel}
          />
        ) : null}

        {showSessionRailOverlay && !isSettingsMode ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="收起会话侧边栏"
              onClick={() => setIsSessionRailCollapsed(true)}
              className="absolute inset-0 bg-[color:color-mix(in_srgb,var(--app-bg-canvas)_72%,transparent)]"
            />
            <div className="absolute inset-y-0 left-0 w-[min(86vw,320px)] px-4 py-4">
              <SessionWorkbenchSidebar
                sessions={renderedSessions}
                selectedSessionId={selectedSessionId}
                debugConversationView={settingsForm.debugConversationView}
                searchValue={sessionSearchQuery}
                activeSidebarPanel={activeSidebarPanel}
                collapsed={false}
                overlay
                deletingSessionId={deletingSessionId}
                loading={loading}
                creatingSession={creatingSession}
                onCreateSession={handleOverlayCreateSession}
                onSearchValueChange={setSessionSearchQuery}
                onSelectSession={handleOverlaySelectSession}
                onDeleteSession={(sessionId) =>
                  void handleDeleteSession(sessionId)
                }
                onToggleSidebarPanel={handleToggleSidebarPanel}
              />
            </div>
          </div>
        ) : null}

        <div className="relative min-h-[calc(100vh-2rem)] min-w-0 flex-1 lg:h-[calc(100vh-2rem)]">
          {isSettingsMode ? (
            <SessionWorkbenchSettings
              activeSettingsPage={activeSettingsPage}
              currentSession={currentSession}
              submitting={submitting}
              resettingRoutines={resettingRoutines}
              weekDates={weekDates}
              groupedRoutines={groupedRoutines}
              settingsMeta={settingsMeta}
              settingsStatusText={settingsStatusText}
              settingsForm={settingsForm}
              settingsChannelsState={settingsChannelsState}
              settingsMcpForm={settingsMcpForm}
              settingsSkillsState={settingsSkillsState}
              permissionTools={permissionTools}
              loadingSettings={loadingSettings}
              savingSettings={savingSettings}
              loadingChannelsSettings={loadingChannelsSettings}
              loadingMcpSettings={loadingMcpSettings}
              loadingSkillsSettings={loadingSkillsSettings}
              savingChannelsSettings={savingChannelsSettings}
              savingMcpSettings={savingMcpSettings}
              mcpSettingsErrorText={mcpSettingsErrorText}
              channelsSettingsErrorText={channelsSettingsErrorText}
              clearingSessionHistory={clearingSessionHistory}
              clearHistoryErrorText={clearHistoryErrorText}
              choosingWorkingDirectory={choosingWorkingDirectory}
              pendingPermissionToolName={pendingPermissionToolName}
              onReturnToApp={focusConversationView}
              onSelectSettingsPage={setActiveSettingsPage}
              onSettingsFormChange={handleSettingsFormChange}
              onSettingsBlur={() => void handleSaveUserSettings()}
              onChooseWorkingDirectory={() =>
                void handleChooseWorkingDirectory()
              }
              onClearSessionHistory={() => void handleClearSessionHistory()}
              onResetAllRoutines={() => void handleResetAllRoutines()}
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
              onSettingsShellAllowPatternRemove={(pattern) =>
                void handleSettingsShellAllowPatternRemove(pattern)
              }
              onSettingsSkillEnabledChange={(skillName, enabled) =>
                void handleSettingsSkillEnabledChange(skillName, enabled)
              }
              onTelegramChannelChange={handleTelegramChannelChange}
              onTelegramChannelEnabledChange={(enabled) =>
                void handleTelegramChannelEnabledChange(enabled)
              }
              onChannelSettingsBlur={() => void handleSaveChannelSettings()}
              onAddMcpServer={handleAddMcpServer}
              onMcpServerChange={handleMcpServerChange}
              onMcpServerTransportChange={handleMcpServerTransportChange}
              onMcpServerEnabledChange={(serverId, enabled) =>
                void handleMcpServerEnabledChange(serverId, enabled)
              }
              onMcpToolEnabledChange={(serverId, toolName, enabled) =>
                void handleMcpToolEnabledChange(serverId, toolName, enabled)
              }
              onDeleteMcpServer={(serverId) =>
                void handleDeleteMcpServer(serverId)
              }
              onMcpSettingsBlur={() => void handleSaveMcpSettings()}
              onAddUserContextHook={handleAddUserContextHook}
              onUserContextHookChange={handleUserContextHookChange}
              onUserContextHookBlur={(hookId) =>
                void maybeSaveUserContextHookForm(
                  settingsForm,
                  settingsForm,
                  hookId
                )
              }
              onUserContextHookEnabledChange={(hookId, enabled) =>
                void handleUserContextHookEnabledChange(hookId, enabled)
              }
              onUserContextHookEventChange={(hookId, event) =>
                void handleUserContextHookEventChange(hookId, event)
              }
              onUserContextHookBehaviorChange={(hookId, behavior) =>
                void handleUserContextHookBehaviorChange(hookId, behavior)
              }
              onUserContextHookWaitModeChange={(hookId, waitMode) =>
                void handleUserContextHookWaitModeChange(hookId, waitMode)
              }
              onDeleteUserContextHook={(hookId) =>
                void handleDeleteUserContextHook(hookId)
              }
              onMoveUserContextHook={(hookId, direction) =>
                void handleMoveUserContextHook(hookId, direction)
              }
            />
          ) : showSidebarPanel ? (
            <SessionWorkbenchDrawer
              activeSidebarPanel={activeSidebarPanel}
              currentSession={currentSession}
              cronJobs={cronJobs}
              currentCronJob={currentCronJob}
              cronFormState={cronFormState}
              cronLoading={loadingCronJobs}
              cronSaving={savingCronJob}
              cronDeletingJobId={deletingCronJobId}
              cronStatusText={cronStatusText}
              cronErrorText={cronErrorText}
              choosingWorkingDirectory={choosingWorkingDirectory}
              modelCatalog={modelCatalog}
              defaultModelId={defaultCronModelId}
              inspectorProjection={inspectorProjection}
              activeTab={activeTab}
              onCreateCronJob={handleCreateCronJob}
              onSelectCronJob={handleSelectCronJob}
              onCronFormChange={handleCronFormChange}
              onSaveCronJob={handleSaveCronJob}
              onToggleCronJobStatus={handleToggleCronJobStatus}
              onDeleteCronJob={(cronJobId) =>
                void handleDeleteCronJob(cronJobId)
              }
              onJumpToCronRun={handleJumpToCronRun}
              onChooseWorkingDirectory={() =>
                void handleChooseCronWorkingDirectory()
              }
              onSelectTab={setActiveTab}
              headerActions={headerActions}
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
              pendingConfirmationPayload={pendingConfirmationPayload}
              pendingUserQuestionPayload={pendingUserQuestionPayload}
              workspaceGitStatus={workspaceGitStatus}
              workspaceGitStatusLoading={workspaceGitStatusLoading}
              message={message}
              submitting={submitting}
              canInterrupt={canInterrupt}
              interrupting={interrupting}
              showInterruptedHint={showInterruptedHint}
              errorText={errorText}
              runFileChanges={runFileChanges}
              forkTargetsByAssistantMessageId={forkTargetsByAssistantMessageId}
              forkingAssistantMessageId={forkingAssistantMessageId}
              rewriteTarget={rewriteTarget}
              editingRewriteMessageId={editingRewriteMessageId}
              rewriteDraft={rewriteDraft}
              recoveringRewriteTarget={recoveringRewriteTarget}
              modelCatalog={modelCatalog}
              selectedModelId={resolveSelectedModelId({
                session: currentSession,
                settingsForm
              })}
              selectedThinkingEffort={resolveSelectedThinkingEffort({
                session: currentSession,
                settingsForm
              })}
              updatingRuntimeSettings={updatingRuntimeSettings}
              onMessageChange={setMessage}
              onSubmit={(event) => void handleSubmit(event)}
              onInterrupt={() => void handleInterruptSession()}
              onSettingsModelChange={(model) =>
                void handleSettingsModelChange(model)
              }
              onSettingsThinkingEffortChange={(thinkingEffort) =>
                void handleSettingsThinkingEffortChange(thinkingEffort)
              }
              onSettingsYoloModeChange={(checked) =>
                void handleSettingsYoloModeChange(checked)
              }
              onSessionPlanModeChange={(checked) =>
                void handleSessionPlanModeChange(checked)
              }
              onEnablePlanModeCommand={() => handleSessionPlanModeChange(true)}
              onSearchWorkspaceFiles={(query, limit) =>
                handleSearchSessionWorkspaceFiles(query, limit)
              }
              onSearchWorkspaceSkills={(query, limit) =>
                handleSearchSessionSkills(query, limit)
              }
              onPermissionQuickReply={(reply) =>
                void handlePermissionQuickReply(reply)
              }
              onConfirmationQuickReply={(reply) =>
                void submitSessionMessage(reply)
              }
              onUserQuestionQuickReply={(reply) =>
                void submitSessionMessage(reply)
              }
              onRunFileChangeAction={(viewKey, action) =>
                void handleRunFileChangeAction(viewKey, action)
              }
              onRunFileSelectionChange={handleRunFileSelectionChange}
              onCreateFork={(assistantMessageId) =>
                void handleCreateFork(assistantMessageId)
              }
              onStartRewrite={handleStartRewrite}
              onRewriteDraftChange={setRewriteDraft}
              onCancelRewrite={handleCancelRewrite}
              onSubmitRewrite={() => void handleSubmitRewrite()}
              onAssistantAnimationComplete={handleAssistantAnimationComplete}
              onToggleExpandedItem={(key) =>
                setSessionLocalStateMap((current) =>
                  selectedSessionId
                    ? toggleExpandedItemForSession(
                        current,
                        selectedSessionId,
                        key
                      )
                    : current
                )
              }
              onAutoCollapseComplete={(key) =>
                setSessionLocalStateMap((current) =>
                  selectedSessionId
                    ? completeAutoCollapseForSession(
                        current,
                        selectedSessionId,
                        key
                      )
                    : current
                )
              }
              headerLeading={sidebarToggleButton}
            />
          )}
        </div>
      </div>
    </main>
  );
}
