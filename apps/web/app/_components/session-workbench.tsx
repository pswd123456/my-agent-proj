"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";

import {
  createApiClient,
  type ModelCatalogEntry,
  type RoutineRecord,
  type RunStreamEvent,
  type SessionForkTarget,
  type SessionSnapshot,
  type SessionWorkspaceGitStatus,
  type SettingsPermissionToolOption,
  type SessionSettingsRecord,
  type TraceRecord,
  type UserContextHookRecord,
  type WorkspaceFileSearchResult,
  type WorkspaceSkillSearchResult,
  type WorkspaceFileChangeSummary
} from "@ai-app-template/sdk";

import {
  buildWeekRange,
  buildMcpServersFromForm,
  buildSessionSettingsPatchFromUserSettings,
  canInterruptSessionExecution,
  createEmptyMcpServerFormState,
  findReusableNewSessionSummary,
  groupRoutinesByDate,
  appendPatternLine,
  normalizeContextWindow,
  normalizeMaxTurns,
  normalizeSettingsFormState,
  patchSettingsForm,
  removePatternLine,
  enforceSingleEnabledUserContextHookType,
  getNextAvailableUserContextHookType,
  resolveSelectedModelId,
  resolveSelectedThinkingEffort,
  splitPatternLines,
  toSettingsMcpFormState,
  toSettingsFormState,
  toSettingsSkillsState
} from "./session-workbench-state";
import {
  bootstrapSessions,
  clearCurrentSession,
  createSessionRegistryState,
  deriveRenderedSessions,
  hydrateSelectedSession,
  replaceSessions,
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
import { SessionWorkbenchSettings } from "./session-workbench-settings";
import type { RunFileChangesView } from "./session-workbench-conversation";
import {
  SESSION_RAIL_COLLAPSE_MEDIA_QUERY,
  resolveSessionRailCollapsedState
} from "./session-workbench-rail";
import {
  DEFAULT_MAX_TURNS,
  clearActiveSidebarPanel,
  type InspectorTabId,
  type SettingsFormState,
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
const SESSION_SEARCH_DEBOUNCE_MS = 180;

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
    .filter((hook) => inferUserContextHookBehavior(hook) === "message")
    .filter(
      (hook) =>
        hook.event === "run_started" ||
        (hook.event === "session_started" && isFirstRun)
    )
    .map((hook) => ({
      event: hook.event,
      title: hook.title.trim()
    }));

  if (hooks.length === 0) {
    return null;
  }

  return {
    runCount: hooks.length,
    hooks
  };
}

export type RunFileChangesState = RunFileChangesView;

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

export function getRunFileChangesAggregateState(
  fileStates: Array<"applied" | "undone">
): RunFileChangesState["state"] {
  if (fileStates.length === 0) {
    return "applied";
  }

  const firstState = fileStates[0] ?? "applied";
  return fileStates.every((state) => state === firstState)
    ? firstState
    : "mixed";
}

export function getSelectedWorkspaceFileChanges(
  view: RunFileChangesState
): WorkspaceFileChangeSummary[] {
  return view.selectedFileIndexes.flatMap((index) => {
    const file = view.files[index];
    return file ? [file] : [];
  });
}

function buildRunFileChangesStateFromFiles(input: {
  key: string;
  createdAt: string;
  files: WorkspaceFileChangeSummary[];
}): RunFileChangesState {
  return {
    key: input.key,
    createdAt: input.createdAt,
    files: input.files,
    fileStates: input.files.map(() => "applied" as const),
    state: "applied",
    selectedFileIndexes: input.files.map((_, index) => index),
    pendingAction: null,
    errorText: null
  };
}

export function buildRunFileChangesStatesFromSession(
  session: SessionSnapshot | null
): RunFileChangesState[] {
  if (!session) {
    return [];
  }

  const views: RunFileChangesState[] = [];
  let runIndex = 0;
  let runKey = `run-file-changes:${session.sessionId}:prelude`;
  let runCreatedAt = "";
  let files: WorkspaceFileChangeSummary[] = [];

  function flushRun() {
    if (files.length === 0) {
      return;
    }

    views.push(
      buildRunFileChangesStateFromFiles({
        key: runKey,
        createdAt: runCreatedAt,
        files
      })
    );
    files = [];
    runCreatedAt = "";
  }

  for (const block of session.messages) {
    if (block.kind === "user") {
      flushRun();
      runIndex += 1;
      runKey = `run-file-changes:${session.sessionId}:${block.id}`;
      runCreatedAt = block.createdAt;
      continue;
    }

    if (
      block.kind !== "tool result" ||
      block.isError ||
      block.details?.kind !== "workspace_file_changes" ||
      block.details.files.length === 0
    ) {
      continue;
    }

    files = [...files, ...block.details.files];
    runCreatedAt =
      runCreatedAt && runCreatedAt > block.createdAt
        ? runCreatedAt
        : block.createdAt;

    if (runKey.endsWith(":prelude")) {
      runKey = `run-file-changes:${session.sessionId}:prelude-${runIndex}`;
    }
  }

  flushRun();
  return views;
}

export function mergeRunFileChangesStates(
  current: RunFileChangesState[],
  next: RunFileChangesState[]
): RunFileChangesState[] {
  const currentByKey = new Map(current.map((view) => [view.key, view]));

  return next.map((view) => {
    const existing = currentByKey.get(view.key);
    if (!existing) {
      return view;
    }

    const filesStillMatch =
      existing.files.length === view.files.length &&
      existing.files.every(
        (file, index) => file.path === view.files[index]?.path
      );
    if (!filesStillMatch) {
      return view;
    }

    const fileStates = view.files.map(
      (_, index) => existing.fileStates[index] ?? "applied"
    );
    const selectedFileIndexes = existing.selectedFileIndexes.filter(
      (index) => index >= 0 && index < view.files.length
    );

    return {
      ...view,
      fileStates,
      state: getRunFileChangesAggregateState(fileStates),
      selectedFileIndexes,
      pendingAction: existing.pendingAction,
      errorText: existing.errorText
    };
  });
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

export function collectWorkspaceFileChangesFromRun(
  event: Extract<RunStreamEvent, { kind: "run_complete" | "run_error" }>
): WorkspaceFileChangeSummary[] {
  if (!("toolOutputs" in event)) {
    return [];
  }

  return event.toolOutputs.flatMap((output) => {
    if (
      output.isError ||
      output.details?.kind !== "workspace_file_changes" ||
      output.details.files.length === 0
    ) {
      return [];
    }

    return output.details.files;
  });
}

export function buildRunFileChangesState(
  event: Extract<RunStreamEvent, { kind: "run_complete" | "run_error" }>
): RunFileChangesState | null {
  const files = collectWorkspaceFileChangesFromRun(event);
  if (files.length === 0) {
    return null;
  }

  return {
    key: `run-file-changes:${event.createdAt}`,
    createdAt: event.createdAt,
    files,
    fileStates: files.map(() => "applied" as const),
    state: "applied",
    selectedFileIndexes: files.map((_, index) => index),
    pendingAction: null,
    errorText: null
  };
}

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
  const sessionListRefreshVersionRef = useRef(0);
  const sessionListMutationInFlightRef = useRef(false);
  const appliedSessionSearchQueryRef = useRef("");

  const [sessionRegistry, setSessionRegistry] = useState(() =>
    createSessionRegistryState()
  );
  const [sessionUiState, setSessionUiState] = useState(() =>
    createSessionUiState(null)
  );
  const [traceRecords, setTraceRecords] = useState<TraceRecord[]>([]);
  const [forkTargets, setForkTargets] = useState<SessionForkTarget[]>([]);
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [messageManagerState, setMessageManagerState] = useState(() =>
    createMessageManagerState()
  );
  const [runFileChanges, setRunFileChanges] = useState<RunFileChangesState[]>(
    []
  );
  const [message, setMessage] = useState("");
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [appliedSessionSearchQuery, setAppliedSessionSearchQuery] =
    useState("");
  const [activeTab, setActiveTab] = useState<InspectorTabId>("prompt");
  const [loading, setLoading] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
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
  const [settingsSkillsState, setSettingsSkillsState] =
    useState<SettingsSkillsState>(toSettingsSkillsState(null));
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingMcpSettings, setLoadingMcpSettings] = useState(false);
  const [loadingSkillsSettings, setLoadingSkillsSettings] = useState(false);
  const [savingMcpSettings, setSavingMcpSettings] = useState(false);
  const [mcpSettingsErrorText, setMcpSettingsErrorText] = useState<
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
  const { sessions, selectedSessionId } = sessionRegistry;
  const [maxTurns, setMaxTurns] = useState(String(DEFAULT_MAX_TURNS));
  const [errorText, setErrorText] = useState<string | null>(null);
  const currentSession = sessionUiState.session;
  const submitting = sessionUiState.submitting;
  const interruptingSessionId = sessionUiState.interruptingSessionId;
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

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

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
    preferredUserIdRef.current =
      currentSession?.context.userId ?? userSettings?.userId ?? null;
  }, [currentSession, userSettings]);

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
            const created = await apiClient.createSession(
              getCreateSessionPayload()
            );
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
      setLoadingMcpSettings(false);
      setLoadingSkillsSettings(false);
      setErrorText(null);

      try {
        const [session, initialForkTargets] = await Promise.all([
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

        setSessionUiState((current) => setSessionSnapshot(current, session));
        setMaxTurns(String(session.maxTurns));
        setSessionRegistry((current) =>
          hydrateSelectedSession(current, session)
        );
        setRunFileChanges((current) =>
          mergeRunFileChangesStates(
            current,
            buildRunFileChangesStatesFromSession(session)
          )
        );
        setForkTargets(initialForkTargets);
        setTraceRecords([]);
        setRoutines([]);
        setLoadingSession(false);

        const week = buildWeekRange(session.context.currentDateContext);
        const [traceResult, routinesResult, settingsResult] =
          await Promise.allSettled([
            apiClient.getSessionTrace(sessionId),
            apiClient.listSessionRoutines(sessionId, {
              startDate: week.startDate,
              endDate: week.endDate
            }),
            apiClient.getUserSettingsPayload(session.context.userId)
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
          setUserSettings(settingsResult.value.settings);
          setPermissionTools(settingsResult.value.permissionTools);
          setSettingsForm(toSettingsFormState(settingsResult.value.settings));
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

    const targetUserId = currentSession?.context.userId ?? userSettings?.userId;
    if (!targetUserId) {
      return;
    }

    let cancelled = false;
    setLoadingMcpSettings(true);
    setLoadingSkillsSettings(true);
    setMcpSettingsErrorText(null);

    void Promise.all([
      apiClient.getUserSettingsMcp(targetUserId),
      apiClient.getUserSettingsSkills(targetUserId)
    ])
      .then(([mcpPayload, skillsPayload]) => {
        if (cancelled) {
          return;
        }

        setSettingsMcpForm(toSettingsMcpFormState(mcpPayload));
        setSettingsSkillsState(toSettingsSkillsState(skillsPayload));
      })
      .catch((error) => {
        if (!cancelled) {
          setMcpSettingsErrorText(
            error instanceof Error ? error.message : String(error)
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMcpSettings(false);
          setLoadingSkillsSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeSidebarPanel,
    currentSession?.context.userId,
    userSettings?.userId
  ]);

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
      const [session, nextForkTargets] = await Promise.all([
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
          ? apiClient.getUserSettingsPayload(session.context.userId)
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

      setSessionUiState((current) => setSessionSnapshot(current, session));
      setForkTargets(nextForkTargets);
      setTraceRecords(trace);
      setRoutines(routinesResult.routines);
      if (settingsPayload) {
        setUserSettings(settingsPayload.settings);
        setPermissionTools(settingsPayload.permissionTools);
        setSettingsForm(toSettingsFormState(settingsPayload.settings));
      }
      setMaxTurns(String(session.maxTurns));
      setSessionRegistry((current) => hydrateSelectedSession(current, session));
      setRunFileChanges((current) =>
        mergeRunFileChangesStates(
          current,
          buildRunFileChangesStatesFromSession(session)
        )
      );
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

  async function handleCreateSession() {
    if (creatingSession) {
      return;
    }

    const reusableSession = findReusableNewSessionSummary(sessions);
    if (reusableSession) {
      clearSessionSearch();
      setErrorText(null);
      focusConversationView();
      setSessionRegistry((current) =>
        selectSession(current, reusableSession.sessionId)
      );
      setRunFileChanges([]);
      setMessageManagerState(resetMessageManagerState());
      router.replace(`/?sessionId=${reusableSession.sessionId}`, {
        scroll: false
      });
      return;
    }

    try {
      clearSessionSearch();
      setCreatingSession(true);
      setErrorText(null);
      beginSessionListMutation();
      const session = await apiClient.createSession(getCreateSessionPayload());
      selectedSessionIdRef.current = session.sessionId;
      setSessionRegistry((current) =>
        upsertSession(selectSession(current, session.sessionId), session)
      );
      focusConversationView();
      setSessionUiState((current) => setSessionSnapshot(current, session));
      setForkTargets([]);
      setTraceRecords([]);
      setRoutines([]);
      setRunFileChanges(buildRunFileChangesStatesFromSession(session));
      setMessageManagerState(resetMessageManagerState());
      router.replace(`/?sessionId=${session.sessionId}`, { scroll: false });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      endSessionListMutation();
      setCreatingSession(false);
    }
  }

  function handleSelectSession(sessionId: string) {
    focusConversationView();
    selectedSessionIdRef.current = sessionId;
    setSessionRegistry((current) => selectSession(current, sessionId));
    setRunFileChanges([]);
    setForkTargets([]);
    setMessageManagerState(resetMessageManagerState());
    router.replace(`/?sessionId=${sessionId}`, { scroll: false });
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
      selectedSessionIdRef.current = forkSession.sessionId;
      setSessionRegistry((current) =>
        hydrateSelectedSession(upsertSession(current, forkSession), forkSession)
      );
      setSessionUiState((current) => setSessionSnapshot(current, forkSession));
      setForkTargets([]);
      setTraceRecords([]);
      setRoutines([]);
      setRunFileChanges(buildRunFileChangesStatesFromSession(forkSession));
      setMessageManagerState(resetMessageManagerState());
      focusConversationView();
      router.replace(`/?sessionId=${forkSession.sessionId}`, { scroll: false });
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
        selectedSessionIdRef.current = null;
      }
      await apiClient.deleteSession(sessionId);
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
      selectedSessionIdRef.current = nextSessionId;
      setSessionRegistry((current) => clearCurrentSession(current));
      setSessionUiState((current) => setSessionSnapshot(current, null));
      setForkTargets([]);
      setTraceRecords([]);
      setRoutines([]);
      setRunFileChanges([]);
      setMessageManagerState(resetMessageManagerState());

      if (nextSessionId) {
        setSessionRegistry((current) => selectSession(current, nextSessionId));
        router.replace(`/?sessionId=${nextSessionId}`, { scroll: false });
        return;
      }

      const newSession = await apiClient.createSession(
        getCreateSessionPayload()
      );
      selectedSessionIdRef.current = newSession.sessionId;
      setSessionRegistry(
        hydrateSelectedSession(createSessionRegistryState(), newSession)
      );
      setSessionUiState((current) => setSessionSnapshot(current, newSession));
      setForkTargets([]);
      router.replace(`/?sessionId=${newSession.sessionId}`, { scroll: false });
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
      selectedSessionIdRef.current = null;
      clearSessionSearch();
      await apiClient.clearSessionHistory();
      setSessionRegistry(createSessionRegistryState());
      setSessionUiState((current) => setSessionSnapshot(current, null));
      setForkTargets([]);
      setTraceRecords([]);
      setRoutines([]);
      setRunFileChanges([]);
      setMessageManagerState(resetMessageManagerState());
      focusConversationView();
      const newSession = await apiClient.createSession(
        getCreateSessionPayload()
      );
      selectedSessionIdRef.current = newSession.sessionId;
      setSessionRegistry(
        hydrateSelectedSession(createSessionRegistryState(), newSession)
      );
      setSessionUiState((current) => setSessionSnapshot(current, newSession));
      setForkTargets([]);
      setRunFileChanges(buildRunFileChangesStatesFromSession(newSession));
      router.replace(`/?sessionId=${newSession.sessionId}`, { scroll: false });
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
      const pendingPreUserHooks = resolvePendingPreUserHooks({
        hooks: settingsForm.userContextHooks,
        session: currentSession
      });
      setMessageManagerState((current) =>
        beginMessageManagerRun(current, {
          message: {
            createdAt: new Date().toISOString(),
            text: nextMessage
          },
          pendingPreUserHooks
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
          const applyStreamEvent = () => {
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
                  setRunFileChanges((current) =>
                    mergeRunFileChangesStates(
                      current,
                      buildRunFileChangesStatesFromSession(nextSession)
                    )
                  );
                }
              }
            }
          };

          if (
            runEvent.kind === "assistant_text" ||
            runEvent.kind === "thinking"
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
    const forceStopRequested =
      interruptingSessionId === sessionId ||
      currentSession.sessionState.interruptRequested;
    setErrorText(null);

    if (forceStopRequested) {
      setSessionUiState((current) => beginSessionInterrupt(current, sessionId));
    }

    try {
      const result = forceStopRequested
        ? await apiClient.forceStopSessionExecution(sessionId)
        : await apiClient.interruptSessionExecution(sessionId);
      setSessionUiState((current) =>
        setSessionSnapshot(current, result.session)
      );
      setSessionRegistry((current) => upsertSession(current, result.session));
      if (result.session.sessionState.loopState === "interrupted") {
        setMessageManagerState((current) => finishMessageManagerRun(current));
      }
    } catch (error) {
      if (forceStopRequested) {
        setSessionUiState((current) =>
          rollbackSessionUiState(current, sessionId)
        );
      }
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRunFileChangeAction(
    viewKey: string,
    action: "undo" | "reapply"
  ) {
    const targetView = runFileChanges.find((view) => view.key === viewKey);
    if (!currentSession || !targetView || targetView.pendingAction) {
      return;
    }

    const selectedFileIndexes = targetView.selectedFileIndexes.filter(
      (index) => index >= 0 && index < targetView.files.length
    );
    const selectedFiles = getSelectedWorkspaceFileChanges(targetView);
    if (selectedFiles.length === 0) {
      setRunFileChanges((current) =>
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

    setRunFileChanges((current) =>
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

    try {
      await apiClient.applySessionFileChangeAction({
        sessionId: currentSession.sessionId,
        action,
        files: selectedFiles
      });
      setRunFileChanges((current) =>
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
      setRunFileChanges((current) =>
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
    }
  }

  function handleRunFileSelectionChange(
    viewKey: string,
    selectedFileIndexes: number[]
  ) {
    setRunFileChanges((current) =>
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
    const targetUserId = currentSession?.context.userId ?? userSettings?.userId;
    if (!targetUserId || savingSettings) {
      return false;
    }

    const normalizedForm = normalizeSettingsFormState(nextForm);

    setSavingSettings(true);
    setErrorText(null);
    setSettingsForm(normalizedForm);

    try {
      const updatedPayload = await apiClient.updateUserSettingsPayload(
        targetUserId,
        {
          workingDirectory: normalizedForm.workingDirectory,
          model: normalizedForm.model,
          thinkingEffort: normalizedForm.thinkingEffort,
          yoloMode: normalizedForm.yoloMode,
          contextWindow: normalizeContextWindow(normalizedForm.contextWindow),
          maxTurns: normalizeMaxTurns(normalizedForm.maxTurns),
          shellAllowPatterns: splitPatternLines(
            normalizedForm.shellAllowPatterns
          ),
          shellDenyPatterns: splitPatternLines(
            normalizedForm.shellDenyPatterns
          ),
          toolAllowList: normalizedForm.toolAllowList,
          toolAskList: normalizedForm.toolAskList,
          toolDenyList: normalizedForm.toolDenyList,
          enabledCapabilityPacks: normalizedForm.enabledCapabilityPacks,
          workspaceSkillSettings: normalizedForm.workspaceSkillSettings,
          userContextHooks: normalizedForm.userContextHooks,
          debugConversationView: normalizedForm.debugConversationView,
          userCustomPrompt: normalizedForm.userCustomPrompt
        }
      );
      const updated = updatedPayload.settings;
      setUserSettings(updated);
      setPermissionTools(updatedPayload.permissionTools);
      setSettingsForm(toSettingsFormState(updated));
      try {
        const [mcpPayload, skillsPayload] = await Promise.all([
          apiClient.getUserSettingsMcp(targetUserId),
          apiClient.getUserSettingsSkills(targetUserId)
        ]);
        setSettingsMcpForm(toSettingsMcpFormState(mcpPayload));
        setSettingsSkillsState(toSettingsSkillsState(skillsPayload));
        setMcpSettingsErrorText(null);
      } catch (error) {
        setMcpSettingsErrorText(
          error instanceof Error ? error.message : String(error)
        );
      }

      if (currentSession && currentSession.context.userId === targetUserId) {
        const syncedSession = await apiClient.updateSessionSettings(
          currentSession.sessionId,
          buildSessionSettingsPatchFromUserSettings(updated)
        );
        setSessionUiState((current) =>
          setSessionSnapshot(current, syncedSession)
        );
        setSessionRegistry((current) => upsertSession(current, syncedSession));
      }
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
    const targetUserId = currentSession?.context.userId ?? userSettings?.userId;
    if (!targetUserId || savingMcpSettings) {
      return false;
    }

    setSavingMcpSettings(true);
    setMcpSettingsErrorText(null);

    try {
      const payload = await apiClient.updateUserSettingsMcp(targetUserId, {
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
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
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
        hooks.map((hook) => (hook.id === hookId ? { ...hook, event } : hook)),
        hookId
      )
    );
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
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
                      waitMode: hook.waitMode ?? "blocking",
                      maxTurns: hook.maxTurns ?? DEFAULT_MAX_TURNS
                    }
                  : {}),
                ...((behavior === "context" || behavior === "subagent") &&
                hook.event === "run_end"
                  ? { event: "run_started" as const }
                  : {})
              }
            : hook
        ),
        hookId
      )
    );
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
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
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
  }

  async function handleDeleteUserContextHook(hookId: string) {
    if (savingSettings) {
      return;
    }

    const nextForm = updateUserContextHookList((hooks) =>
      hooks.filter((hook) => hook.id !== hookId)
    );
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
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
    setSettingsForm(nextForm);
    await handleSaveUserSettings(nextForm);
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

    try {
      const updatedSession = await apiClient.updateSessionSettings(
        currentSession.sessionId,
        {
          model
        }
      );
      setSessionUiState((current) =>
        setSessionSnapshot(current, updatedSession)
      );
      setSessionRegistry((current) => upsertSession(current, updatedSession));

      const settingsPayload = await apiClient.updateUserSettingsPayload(
        currentSession.context.userId,
        { model }
      );
      setUserSettings(settingsPayload.settings);
      setPermissionTools(settingsPayload.permissionTools);
      setSettingsForm(toSettingsFormState(settingsPayload.settings));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSettingsThinkingEffortChange(thinkingEffort: string) {
    if (!currentSession) {
      return;
    }

    const normalizedThinkingEffort = thinkingEffort === "max" ? "max" : "high";
    setErrorText(null);

    try {
      const updatedSession = await apiClient.updateSessionSettings(
        currentSession.sessionId,
        {
          thinkingEffort: normalizedThinkingEffort
        }
      );
      setSessionUiState((current) =>
        setSessionSnapshot(current, updatedSession)
      );
      setSessionRegistry((current) => upsertSession(current, updatedSession));

      const settingsPayload = await apiClient.updateUserSettingsPayload(
        currentSession.context.userId,
        { thinkingEffort: normalizedThinkingEffort }
      );
      setUserSettings(settingsPayload.settings);
      setPermissionTools(settingsPayload.permissionTools);
      setSettingsForm(toSettingsFormState(settingsPayload.settings));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
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
      setSessionUiState((current) => setSessionSnapshot(current, updated));
      setSessionRegistry((current) => upsertSession(current, updated));
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
            onCreateSession={handleCreateSession}
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
              settingsMeta={settingsMeta}
              settingsStatusText={settingsStatusText}
              settingsForm={settingsForm}
              settingsMcpForm={settingsMcpForm}
              settingsSkillsState={settingsSkillsState}
              permissionTools={permissionTools}
              loadingSettings={loadingSettings}
              savingSettings={savingSettings}
              loadingMcpSettings={loadingMcpSettings}
              loadingSkillsSettings={loadingSkillsSettings}
              savingMcpSettings={savingMcpSettings}
              mcpSettingsErrorText={mcpSettingsErrorText}
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
              onUserContextHookBlur={() => void handleSaveUserSettings()}
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
              loadingSession={loadingSession}
              submitting={submitting}
              resettingRoutines={resettingRoutines}
              settingsMeta={settingsMeta}
              settingsStatusText={settingsStatusText}
              settingsForm={settingsForm}
              settingsMcpForm={settingsMcpForm}
              settingsSkillsState={settingsSkillsState}
              permissionTools={permissionTools}
              loadingSettings={loadingSettings}
              savingSettings={savingSettings}
              loadingMcpSettings={loadingMcpSettings}
              loadingSkillsSettings={loadingSkillsSettings}
              savingMcpSettings={savingMcpSettings}
              mcpSettingsErrorText={mcpSettingsErrorText}
              clearingSessionHistory={clearingSessionHistory}
              clearHistoryErrorText={clearHistoryErrorText}
              choosingWorkingDirectory={choosingWorkingDirectory}
              pendingPermissionToolName={pendingPermissionToolName}
              weekDates={weekDates}
              groupedRoutines={groupedRoutines}
              inspectorProjection={inspectorProjection}
              activeTab={activeTab}
              onResetAllRoutines={() => void handleResetAllRoutines()}
              onSelectTab={setActiveTab}
              onSettingsFormChange={handleSettingsFormChange}
              onSettingsBlur={() => void handleSaveUserSettings()}
              onChooseWorkingDirectory={() =>
                void handleChooseWorkingDirectory()
              }
              onClearSessionHistory={() => void handleClearSessionHistory()}
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
              onUserContextHookBlur={() => void handleSaveUserSettings()}
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
              modelCatalog={modelCatalog}
              selectedModelId={resolveSelectedModelId({
                session: currentSession,
                settingsForm
              })}
              selectedThinkingEffort={resolveSelectedThinkingEffort({
                session: currentSession,
                settingsForm
              })}
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
