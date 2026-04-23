"use client";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import type {
  RoutineRecord,
  RunStreamEvent,
  SessionSnapshot
} from "@ai-app-template/sdk";

import type { ToolRow } from "./session-workbench-state";
import { getTimelineEventKey } from "./session-timeline";
import {
  inspectorTabs,
  MAX_TURNS_LIMIT,
  permissionToolOptions,
  type InspectorTabId,
  type SettingsFormState,
  type SidebarPanelId
} from "./session-workbench-types";
import {
  formatDayLabel,
  formatTimestamp,
  formatWorkingDirectory,
  getDebugPreClass,
  getInspectorCardClass,
  getPermissionDecisionLabel,
  getPermissionToolLabel,
  getSoftBlockClass,
  stringify
} from "./session-workbench-shared";

type PromptEvent = Extract<RunStreamEvent, { kind: "prompt" }>;
type ThinkingEvent = Extract<RunStreamEvent, { kind: "thinking" }>;

const sectionHeadingClassName =
  "text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]";
const tertiaryHeadingClassName =
  "text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]";

interface SessionWorkbenchDrawerProps {
  activeSidebarPanel: SidebarPanelId | null;
  currentSession: SessionSnapshot | null;
  loadingSession: boolean;
  submitting: boolean;
  resettingRoutines: boolean;
  settingsMeta: string;
  settingsStatusText: string;
  settingsForm: SettingsFormState;
  loadingSettings: boolean;
  savingSettings: boolean;
  pendingPermissionToolName: string | null;
  weekDates: string[];
  groupedRoutines: Map<string, RoutineRecord[]>;
  inspectorEvents: RunStreamEvent[];
  activeTab: InspectorTabId;
  latestPromptEvent: PromptEvent | undefined;
  thinkingEvents: ThinkingEvent[];
  toolRows: ToolRow[];
  onResetAllRoutines: () => void;
  onSelectTab: (tabId: InspectorTabId) => void;
  onSettingsFormChange: (patch: Partial<SettingsFormState>) => void;
  onSettingsBlur: () => void;
  onSettingsYoloModeChange: (checked: boolean) => void;
  onSettingsPermissionToolToggle: (
    toolName: string,
    target: "allow" | "ask" | "deny"
  ) => void;
}

export function SessionWorkbenchDrawer({
  activeSidebarPanel,
  currentSession,
  loadingSession,
  submitting,
  resettingRoutines,
  settingsMeta,
  settingsStatusText,
  settingsForm,
  loadingSettings,
  savingSettings,
  pendingPermissionToolName,
  weekDates,
  groupedRoutines,
  inspectorEvents,
  activeTab,
  latestPromptEvent,
  thinkingEvents,
  toolRows,
  onResetAllRoutines,
  onSelectTab,
  onSettingsFormChange,
  onSettingsBlur,
  onSettingsYoloModeChange,
  onSettingsPermissionToolToggle
}: SessionWorkbenchDrawerProps) {
  if (!activeSidebarPanel) {
    return null;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <WorkbenchPanel
        eyebrow={
          activeSidebarPanel === "settings"
            ? "Settings"
            : activeSidebarPanel === "calendar"
              ? "Calendar"
              : "Inspector"
        }
        title={
          activeSidebarPanel === "settings"
            ? "用户默认设置"
            : activeSidebarPanel === "calendar"
              ? "日程视图"
              : "调试详情"
        }
        meta={
          activeSidebarPanel === "settings"
            ? settingsMeta
            : activeSidebarPanel === "calendar"
              ? (currentSession?.context.currentDateContext ?? "--")
              : `${inspectorEvents.length} events`
        }
      >
        <div className="grid min-h-0 min-w-0 gap-3">
          {activeSidebarPanel === "settings" ? (
            <div className="grid gap-3">
              <div
                className={getSoftBlockClass(
                  "text-sm leading-6 text-[var(--app-text-secondary)]"
                )}
              >
                这里配置默认值。修改后会自动保存，后续新建会话会直接使用；当前会话的权限和 yolo 也会同步更新。
              </div>

              <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                <span className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Default Working Directory
                </span>
                <input
                  value={settingsForm.workingDirectory}
                  onChange={(event) =>
                    onSettingsFormChange({
                      workingDirectory: event.target.value
                    })
                  }
                  onBlur={onSettingsBlur}
                  placeholder="agent-workspace"
                  className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                />
                <span className="text-xs leading-6 text-[var(--app-text-muted)]">
                  留空会回到 repo 根下的 `agent-workspace/`。自定义 cwd
                  会被解析并限制在仓库根目录内。
                </span>
              </label>

              <div className="grid gap-2">
                <div className={sectionHeadingClassName}>Shell Permission</div>
                <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                  <span className={tertiaryHeadingClassName}>
                    Allow Patterns
                  </span>
                  <textarea
                    value={settingsForm.shellAllowPatterns}
                    onChange={(event) =>
                      onSettingsFormChange({
                        shellAllowPatterns: event.target.value
                      })
                    }
                    onBlur={onSettingsBlur}
                    rows={3}
                    placeholder={"ls *\nls -la *"}
                    className="w-full resize-none rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                </label>
                <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                  <span className={tertiaryHeadingClassName}>
                    Deny Patterns
                  </span>
                  <textarea
                    value={settingsForm.shellDenyPatterns}
                    onChange={(event) =>
                      onSettingsFormChange({
                        shellDenyPatterns: event.target.value
                      })
                    }
                    onBlur={onSettingsBlur}
                    rows={3}
                    placeholder={"rm -rf *"}
                    className="w-full resize-none rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                </label>
              </div>

              <div className="grid gap-3">
                <div className={sectionHeadingClassName}>Tool Permission</div>
                <div className="grid gap-2">
                  <div className={tertiaryHeadingClassName}>
                    Allow / Ask / Deny Buttons
                  </div>
                  <div className="grid gap-2">
                    {permissionToolOptions.map((toolName) => {
                      const isAllowed =
                        settingsForm.toolAllowList.includes(toolName);
                      const isAsk = settingsForm.toolAskList.includes(toolName);
                      const isDenied =
                        settingsForm.toolDenyList.includes(toolName);
                      const permissionStateLabel =
                        isAllowed && isDenied
                          ? "冲突"
                          : isAllowed
                            ? "已允许"
                            : isAsk
                              ? "询问"
                              : isDenied
                                ? "已拒绝"
                                : "询问";
                      const permissionStateClass =
                        isAllowed && isDenied
                          ? "border-[var(--app-status-warning)] text-[var(--app-status-warning)]"
                          : isAllowed
                            ? "border-[var(--app-status-success)] text-[var(--app-status-success)]"
                            : isAsk
                              ? "border-[var(--app-border-accent)] text-[var(--app-text-primary)]"
                              : isDenied
                                ? "border-[var(--app-status-danger)] text-[var(--app-status-danger)]"
                                : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)]";
                      const isSavingThisTool =
                        pendingPermissionToolName === toolName &&
                        savingSettings;

                      return (
                        <div
                          key={toolName}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-3 py-3"
                        >
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            <span className="text-sm text-[var(--app-text-secondary)]">
                              {getPermissionToolLabel(toolName)}
                            </span>
                            <span
                              className={`rounded-[var(--app-radius-pill)] border px-2.5 py-1 text-[0.72rem] uppercase tracking-[0.14em] ${permissionStateClass}`}
                            >
                              {isSavingThisTool
                                ? "保存中"
                                : permissionStateLabel}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                onSettingsPermissionToolToggle(
                                  toolName,
                                  "allow"
                                )
                              }
                              disabled={loadingSettings || savingSettings}
                              className={`rounded-[var(--app-radius-pill)] border px-3 py-1.5 text-xs transition ${
                                isAllowed
                                  ? "border-[var(--app-status-success)] bg-[color:color-mix(in_srgb,var(--app-status-success)_10%,transparent)] text-[var(--app-status-success)]"
                                  : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)]"
                              } disabled:cursor-not-allowed`}
                            >
                              Allow
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onSettingsPermissionToolToggle(toolName, "ask")
                              }
                              disabled={loadingSettings || savingSettings}
                              className={`rounded-[var(--app-radius-pill)] border px-3 py-1.5 text-xs transition ${
                                isAsk
                                  ? "border-[var(--app-border-accent)] bg-[color:color-mix(in_srgb,var(--app-border-accent)_12%,transparent)] text-[var(--app-text-primary)]"
                                  : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)]"
                              } disabled:cursor-not-allowed`}
                            >
                              Ask
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onSettingsPermissionToolToggle(toolName, "deny")
                              }
                              disabled={loadingSettings || savingSettings}
                              className={`rounded-[var(--app-radius-pill)] border px-3 py-1.5 text-xs transition ${
                                isDenied
                                  ? "border-[var(--app-status-danger)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] text-[var(--app-status-danger)]"
                                  : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)]"
                              } disabled:cursor-not-allowed`}
                            >
                              Deny
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

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
                      onSettingsFormChange({
                        contextWindow: event.target.value
                      })
                    }
                    onBlur={onSettingsBlur}
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
                      onSettingsFormChange({
                        maxTurns: event.target.value
                      })
                    }
                    onBlur={onSettingsBlur}
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
                    作为新会话的默认值使用。开启后会放宽部分文件操作确认，其他高风险操作仍需审批。
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settingsForm.yoloMode}
                  onChange={(event) =>
                    onSettingsYoloModeChange(event.target.checked)
                  }
                  disabled={loadingSettings || savingSettings}
                  className="h-5 w-5 rounded border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] text-[var(--app-status-success)]"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--app-text-muted)]">
                <span>{settingsStatusText}</span>
                <span>
                  当前会话: cwd{" "}
                  {formatWorkingDirectory(
                    currentSession?.workingDirectory ?? "--"
                  )}{" "}
                  / yolo {currentSession?.context.yoloMode ? "on" : "off"}
                </span>
              </div>
            </div>
          ) : null}

          {activeSidebarPanel === "calendar" ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
              <div className="col-span-full flex justify-end">
                <button
                  type="button"
                  onClick={onResetAllRoutines}
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
              </div>

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
          ) : null}

          {activeSidebarPanel === "inspector" ? (
            <div className="flex min-h-[24rem] min-w-0 flex-col">
              <div className="flex min-w-0 flex-wrap gap-2">
                {inspectorTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectTab(tab.id)}
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
                  latestPromptEvent ? (
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
                          {stringify(latestPromptEvent.runtimeContextMessages)}
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
          ) : null}
        </div>
      </WorkbenchPanel>
    </div>
  );
}
