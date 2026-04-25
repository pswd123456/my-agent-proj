"use client";

import type { SessionSnapshot, SessionSummary } from "@ai-app-template/sdk";

import {
  getSessionDisplayState,
  parseDateString,
  type SessionDisplayState
} from "./session-workbench-state";
import { sidebarPanels, type SidebarPanelId } from "./session-workbench-types";

interface CreateSessionDialogProps {
  open: boolean;
  creatingSession: boolean;
  onClose: () => void;
  onCreate: () => void;
}

interface SessionWorkbenchSidebarProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  activeSidebarPanel: SidebarPanelId | null;
  collapsed: boolean;
  deletingSessionId: string | null;
  loading: boolean;
  creatingSession: boolean;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onToggleCollapsed: () => void;
  onToggleSidebarPanel: (panelId: SidebarPanelId) => void;
}

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatDayLabel(value: string): string {
  return parseDateString(value).toLocaleDateString("zh-CN", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit"
  });
}

export function formatWorkingDirectory(value: string): string {
  if (value.length <= 48) {
    return value;
  }

  return `${value.slice(0, 24)}...${value.slice(-18)}`;
}

export function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function expandEscapedLineBreaks(value: string): string {
  return value.replace(/\\r\\n|\\n|\\r/g, "\n");
}

export function stringifyPromptDebugValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return expandEscapedLineBreaks(JSON.stringify(value, null, 2) ?? "");
}

export interface PromptMessageSection {
  turnCount: number;
  createdAt: string;
  summary: string;
  mode: "full" | "diff";
  fullText: string;
  addedText: string;
  removedText: string;
}

function normalizeMessageLines(value: unknown): string[] {
  const text = stringifyPromptDebugValue(value);
  return text.split("\n");
}

function formatDeltaLines(lines: string[], prefix: "+" | "-"): string {
  if (!lines.length) {
    return "(none)";
  }

  return lines.map((line) => `${prefix} ${line}`).join("\n");
}

export function buildPromptMessageSections(
  promptEvents: Array<
    Extract<import("@ai-app-template/sdk").RunStreamEvent, { kind: "prompt" }>
  >
): PromptMessageSection[] {
  let previousSerialized: string[] | null = null;

  return promptEvents.map((event) => {
    const currentSerialized = normalizeMessageLines({
      prefixMessages: event.prefixMessages,
      messages: event.messages,
      runtimeContextMessages: event.runtimeContextMessages
    });

    if (!previousSerialized) {
      previousSerialized = currentSerialized;
      return {
        turnCount: event.turnCount,
        createdAt: event.createdAt,
        summary: `完整上下文 · ${currentSerialized.length} lines`,
        mode: "full",
        fullText: currentSerialized.join("\n"),
        addedText: "",
        removedText: ""
      };
    }

    const previousSet = new Set(previousSerialized);
    const currentSet = new Set(currentSerialized);
    const added = currentSerialized.filter((line) => !previousSet.has(line));
    const removed = previousSerialized.filter((line) => !currentSet.has(line));

    previousSerialized = currentSerialized;

    return {
      turnCount: event.turnCount,
      createdAt: event.createdAt,
      summary: `增量视图 · +${added.length} / -${removed.length}`,
      mode: "diff",
      fullText: currentSerialized.join("\n"),
      addedText: formatDeltaLines(added, "+"),
      removedText: formatDeltaLines(removed, "-")
    };
  });
}

export function formatTokenCount(value: number): string {
  return Math.max(0, value).toLocaleString("zh-CN");
}

export function formatCacheUsage(usage: {
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}): string {
  return `read ${formatTokenCount(usage.cacheReadInputTokens)} / write ${formatTokenCount(usage.cacheCreationInputTokens)}`;
}

export function formatContextWindowUsage(
  inputTokensCount: number,
  contextWindow: number
): string {
  if (contextWindow <= 0) {
    return `${formatTokenCount(inputTokensCount)} / ctx --`;
  }

  const usagePercent = (inputTokensCount / contextWindow) * 100;
  return `${formatTokenCount(inputTokensCount)} / ctx ${formatTokenCount(contextWindow)} (${usagePercent.toFixed(1)}%)`;
}

export function getStateTone(
  loopState: SessionSnapshot["sessionState"]["loopState"]
): string {
  if (loopState === "completed") {
    return "text-[var(--app-status-success)]";
  }

  if (loopState === "interrupted") {
    return "text-[var(--app-status-warning)]";
  }

  if (loopState === "failed") {
    return "text-[var(--app-status-danger)]";
  }

  if (loopState === "waiting for tool result") {
    return "text-[var(--app-status-warning)]";
  }

  return "text-[var(--app-text-secondary)]";
}

export function getDisplayStateToneClass(
  tone: SessionDisplayState["tone"]
): string {
  switch (tone) {
    case "active":
      return "text-[color:color-mix(in_srgb,var(--app-border-accent)_78%,white_22%)]";
    case "success":
      return "text-[var(--app-status-success)]";
    case "warning":
      return "text-[color:color-mix(in_srgb,var(--app-status-warning)_88%,white_12%)]";
    case "danger":
      return "text-[var(--app-status-danger)]";
    case "neutral":
      return "text-[var(--app-text-secondary)]";
  }
}

export function getSidebarStateBadgeClass(
  tone: SessionDisplayState["tone"]
): string {
  switch (tone) {
    case "active":
      return "text-[color:color-mix(in_srgb,var(--app-border-accent)_78%,white_22%)]";
    case "success":
      return "text-[var(--app-status-success)]";
    case "warning":
      return "text-[color:color-mix(in_srgb,var(--app-status-warning)_88%,white_12%)]";
    case "danger":
      return "text-[var(--app-status-danger)]";
    case "neutral":
      return "text-[var(--app-text-secondary)]";
  }
}

export function getPermissionFamilyLabel(family: string): string {
  switch (family) {
    case "workspace-file":
      return "workspace file";
    case "workspace-shell":
      return "workspace shell";
    case "workspace-network":
      return "workspace network";
    case "mcp":
      return "mcp";
    case "schedule":
      return "schedule";
    default:
      return family;
  }
}

export function getPermissionToolLabel(toolName: string): string {
  return toolName.replaceAll("_", " ");
}

export function getPermissionDecisionLabel(
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

export function getBubbleClass(kind: "user" | "assistant"): string {
  if (kind === "user") {
    return "ml-auto max-w-[88%] rounded-[var(--app-radius-lg)] rounded-br-md border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-3 text-sm leading-7 text-[var(--app-text-primary)]";
  }

  return "max-w-[92%] rounded-[var(--app-radius-lg)] rounded-bl-md border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm leading-7 text-[var(--app-text-secondary)]";
}

export function getDebugPreClass(
  surface: "muted" | "surface" = "muted"
): string {
  const backgroundClass =
    surface === "surface"
      ? "bg-[color:color-mix(in_srgb,var(--app-bg-surface)_88%,white_12%)]"
      : "bg-[color:color-mix(in_srgb,var(--app-bg-muted)_88%,var(--app-bg-surface)_12%)]";

  return `mt-2 min-w-0 whitespace-pre-wrap rounded-[var(--app-radius-lg)] ${backgroundClass} px-3 py-3 text-xs leading-6 text-[var(--app-text-secondary)] [overflow-wrap:anywhere]`;
}

export function getInspectorCardClass(extraClassName = ""): string {
  return `min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_86%,var(--app-bg-surface)_14%)] px-4 py-4 ${extraClassName}`.trim();
}

export function getSoftBlockClass(extraClassName = ""): string {
  return `min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] px-4 py-4 ${extraClassName}`.trim();
}

export function CreateSessionDialog({
  open,
  creatingSession,
  onClose,
  onCreate
}: CreateSessionDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="关闭创建会话弹窗"
        onClick={onClose}
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
              会话会继承当前 user settings 的默认 cwd、YOLO、context window 和
              max turns。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-xs text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
          >
            关闭
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={creatingSession}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creatingSession ? "创建中..." : "创建会话"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionWorkbenchSidebar({
  sessions,
  selectedSessionId,
  activeSidebarPanel,
  collapsed,
  deletingSessionId,
  loading,
  creatingSession,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onToggleCollapsed,
  onToggleSidebarPanel
}: SessionWorkbenchSidebarProps) {
  const railWidthClass = collapsed ? "lg:w-[92px]" : "lg:w-[320px]";

  function getPanelShortLabel(panelId: SidebarPanelId): string {
    switch (panelId) {
      case "settings":
        return "SET";
      case "calendar":
        return "CAL";
      case "inspector":
        return "DBG";
    }

    return "PANEL";
  }

  function renderPanelButton(panel: (typeof sidebarPanels)[number]) {
    const isActive = activeSidebarPanel === panel.id;

    if (collapsed) {
      return (
        <button
          key={panel.id}
          type="button"
          title={panel.title}
          aria-label={panel.title}
          onClick={() => onToggleSidebarPanel(panel.id)}
          className={`flex h-11 w-full items-center justify-center rounded-[var(--app-radius-lg)] border text-[0.72rem] font-medium uppercase tracking-[0.14em] transition ${
            isActive
              ? "border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] text-[var(--app-text-primary)]"
              : "border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
          }`}
        >
          {getPanelShortLabel(panel.id)}
        </button>
      );
    }

    return (
      <button
        key={panel.id}
        type="button"
        onClick={() => onToggleSidebarPanel(panel.id)}
        className={`flex items-center justify-between rounded-[var(--app-radius-lg)] border px-3 py-2.5 text-left text-sm transition ${
          isActive
            ? "border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] text-[var(--app-text-primary)]"
            : "border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
        }`}
      >
        <span>{panel.title}</span>
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
          {isActive ? "open" : "view"}
        </span>
      </button>
    );
  }

  return (
    <aside
      className={`w-full shrink-0 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] ${railWidthClass}`}
    >
      <div className="flex h-full min-h-[20rem] flex-col rounded-[var(--app-radius-xl)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_92%,var(--app-bg-elevated)_8%)] shadow-[var(--app-shadow-lg)]">
        <div
          className={`border-b border-[var(--app-border-subtle)] ${collapsed ? "px-3 py-3" : "px-4 py-4"}`}
        >
          <div
            className={`flex items-start gap-3 ${collapsed ? "justify-center" : "justify-between"}`}
          >
            {collapsed ? null : (
              <div className="min-w-0">
                <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Sessions
                </div>
                <div className="mt-2 text-base font-semibold text-[var(--app-text-primary)]">
                  会话侧边栏
                </div>
              </div>
            )}
            <button
              type="button"
              title={collapsed ? "展开会话侧边栏" : "收起会话侧边栏"}
              aria-label={collapsed ? "展开会话侧边栏" : "收起会话侧边栏"}
              onClick={onToggleCollapsed}
              className={`inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] text-xs text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] ${collapsed ? "h-10 w-full" : "h-9 px-3"}`}
            >
              {collapsed ? ">>" : "<<"}
            </button>
          </div>
          <button
            type="button"
            onClick={onCreateSession}
            disabled={loading || creatingSession}
            title="创建新会话"
            aria-label="创建新会话"
            className={`inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50 ${collapsed ? "mt-3 h-10 w-full text-lg leading-none" : "mt-4 w-full px-4 py-2 text-sm"}`}
          >
            {collapsed ? "+" : "创建新会话"}
          </button>
        </div>

        <div
          className={`border-b border-[var(--app-border-subtle)] ${collapsed ? "px-3 py-3" : "px-4 py-4"}`}
        >
          {collapsed ? null : (
            <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              侧边面板
            </div>
          )}
          <div className={`grid gap-2 ${collapsed ? "" : "mt-3"}`}>
            {sidebarPanels.map(renderPanelButton)}
          </div>
        </div>

        <div
          className={`flex-1 overflow-y-auto ${collapsed ? "px-3 py-3" : "px-4 py-4"}`}
        >
          <div className={`grid ${collapsed ? "gap-2" : "gap-3"}`}>
            {sessions.map((session) => {
              const isActive = session.sessionId === selectedSessionId;
              const isDeleting = deletingSessionId === session.sessionId;
              const displayState = getSessionDisplayState(session);
              const stateToneClass = getDisplayStateToneClass(
                displayState.tone
              );
              const stateBadgeClass = getSidebarStateBadgeClass(
                displayState.tone
              );

              if (collapsed) {
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    title={`${session.sessionId.slice(0, 8)} · ${displayState.label}`}
                    aria-label={`切换到会话 ${session.sessionId.slice(0, 8)}`}
                    onClick={() => onSelectSession(session.sessionId)}
                    className={`grid h-14 w-full place-items-center rounded-[var(--app-radius-lg)] border text-center transition ${
                      isActive
                        ? "border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] shadow-[inset_0_0_0_1px_var(--app-border-accent)]"
                        : "border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] hover:border-[var(--app-border-strong)]"
                    }`}
                  >
                    <span
                      className={`font-mono text-[0.7rem] uppercase ${stateToneClass}`}
                    >
                      {session.sessionId.slice(0, 4)}
                    </span>
                  </button>
                );
              }

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
                      onClick={() => onSelectSession(session.sessionId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="font-mono text-[0.72rem] text-[var(--app-text-muted)]">
                        {session.sessionId.slice(0, 8)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center px-0 py-0 text-[0.72rem] font-medium ${stateBadgeClass}`}
                          title={displayState.detail}
                        >
                          {displayState.label}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.sessionId)}
                      disabled={isDeleting}
                      className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-2.5 py-1 text-[0.72rem] text-[var(--app-text-muted)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDeleting ? "删除中" : "删除"}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectSession(session.sessionId)}
                    className="mt-3 block w-full text-left"
                  >
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.72rem] text-[var(--app-text-muted)]">
                      <span>{formatTimestamp(session.updatedAt)}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {session.pendingPermission ? (
                          <span className="text-[var(--app-status-warning)]">
                            权限
                          </span>
                        ) : null}
                        {session.pendingConfirmation ? (
                          <span className="text-[var(--app-status-warning)]">
                            冲突确认
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
  );
}
