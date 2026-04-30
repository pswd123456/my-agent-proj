"use client";

import type { ReactNode } from "react";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import type {
  RoutineRecord,
  SessionSnapshot,
  SettingsPermissionToolOption
} from "@ai-app-template/sdk";

import {
  capabilityPackOptions,
  MAX_TURNS_LIMIT,
  type InspectorTabId,
  type SettingsFormState,
  type SidebarPanelId
} from "./session-workbench-types";
import {
  formatDayLabel,
  getPermissionToolLabel,
  getSoftBlockClass,
  WorkbenchSwitch
} from "./session-workbench-shared";
import type { InspectorProjection } from "./session-message-manager";
import { SessionWorkbenchInspector } from "./session-workbench-inspector";

const sectionHeadingClassName =
  "text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]";
const tertiaryHeadingClassName =
  "text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]";

function formatToolOptionLabel(toolName: string): string {
  return toolName.replaceAll("_", " ");
}

function formatCapabilityPackLabel(packName: string): string {
  if (packName === "workspace") {
    return "Workspace";
  }
  if (packName === "schedule") {
    return "Schedule";
  }
  if (packName === "web") {
    return "Web";
  }
  return packName;
}

function formatCapabilityPackDescription(packName: string): string {
  if (packName === "workspace") {
    return "文件、搜索、shell 与网络等工作区能力。";
  }
  if (packName === "schedule") {
    return "日程创建、编辑、查询与冲突确认相关能力。";
  }
  if (packName === "web") {
    return "网页搜索与静态网页正文抓取。";
  }
  return packName;
}

function getVisiblePermissionTools(
  permissionTools: SettingsPermissionToolOption[],
  enabledCapabilityPacks: string[]
): SettingsPermissionToolOption[] {
  const enabled = new Set(enabledCapabilityPacks);

  return permissionTools.filter((tool) =>
    tool.capabilityPack ? enabled.has(tool.capabilityPack) : true
  );
}

interface SessionWorkbenchDrawerProps {
  activeSidebarPanel: SidebarPanelId | null;
  currentSession: SessionSnapshot | null;
  loadingSession: boolean;
  submitting: boolean;
  resettingRoutines: boolean;
  settingsMeta: string;
  settingsStatusText: string;
  settingsForm: SettingsFormState;
  permissionTools: SettingsPermissionToolOption[];
  loadingSettings: boolean;
  savingSettings: boolean;
  clearingSessionHistory: boolean;
  clearHistoryErrorText: string | null;
  choosingWorkingDirectory: boolean;
  pendingPermissionToolName: string | null;
  weekDates: string[];
  groupedRoutines: Map<string, RoutineRecord[]>;
  inspectorProjection: InspectorProjection;
  activeTab: InspectorTabId;
  onResetAllRoutines: () => void;
  onSelectTab: (tabId: InspectorTabId) => void;
  onSettingsFormChange: (patch: Partial<SettingsFormState>) => void;
  onSettingsBlur: () => void;
  onChooseWorkingDirectory: () => void;
  onClearSessionHistory: () => void;
  onSettingsYoloModeChange: (checked: boolean) => void;
  onSettingsDebugConversationViewChange: (checked: boolean) => void;
  onSettingsPermissionToolToggle: (
    toolName: string,
    target: "allow" | "ask" | "deny"
  ) => void;
  onSettingsCapabilityPackToggle: (packName: string) => void;
  headerActions?: ReactNode;
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
  permissionTools,
  loadingSettings,
  savingSettings,
  clearingSessionHistory,
  clearHistoryErrorText,
  choosingWorkingDirectory,
  pendingPermissionToolName,
  weekDates,
  groupedRoutines,
  inspectorProjection,
  activeTab,
  onResetAllRoutines,
  onSelectTab,
  onSettingsFormChange,
  onSettingsBlur,
  onChooseWorkingDirectory,
  onClearSessionHistory,
  onSettingsYoloModeChange,
  onSettingsDebugConversationViewChange,
  onSettingsPermissionToolToggle,
  onSettingsCapabilityPackToggle,
  headerActions
}: SessionWorkbenchDrawerProps) {
  if (!activeSidebarPanel) {
    return null;
  }

  const visiblePermissionTools = getVisiblePermissionTools(
    permissionTools,
    settingsForm.enabledCapabilityPacks
  );

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
              : `${inspectorProjection.inspectorEvents.length} events`
        }
        headerActions={headerActions}
      >
        <div className="grid min-h-0 min-w-0 gap-3">
          {activeSidebarPanel === "settings" ? (
            <div className="grid gap-3">
              <div
                className={getSoftBlockClass(
                  "text-sm leading-6 text-[var(--app-text-secondary)]"
                )}
              >
                这里配置默认值。修改后会自动保存，后续新建会话会直接使用；当前会话的权限和
                yolo 也会同步更新。
              </div>

              {currentSession ? (
                <div className="grid gap-2">
                  <div className={sectionHeadingClassName}>Current Session</div>
                  <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-secondary)]">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                          Model
                        </div>
                        <div className="mt-2 break-all font-mono text-xs leading-6 text-[var(--app-text-primary)]">
                          {currentSession.model}
                        </div>
                      </div>
                      <div>
                        <div className="text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                          Task Brief Path
                        </div>
                        <div className="mt-2 break-all font-mono text-xs leading-6 text-[var(--app-text-primary)]">
                          {currentSession.context.taskBriefPath ?? "--"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {currentSession ? (
                <div className="grid gap-2">
                  <div className={tertiaryHeadingClassName}>History</div>
                  <button
                    type="button"
                    onClick={onClearSessionHistory}
                    disabled={
                      loadingSettings ||
                      savingSettings ||
                      clearingSessionHistory ||
                      !currentSession
                    }
                    className="rounded-[var(--app-radius-pill)] border border-[var(--app-status-danger)] px-4 py-3 text-left text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-status-danger)] transition hover:bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {clearingSessionHistory ? "清除中..." : "清除历史会话"}
                  </button>
                  <div className="text-xs leading-6 text-[var(--app-text-muted)]">
                    删除所有会话记录，保留当前设置并重新开始。
                  </div>
                  {clearHistoryErrorText ? (
                    <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-6 text-[var(--app-status-danger)]">
                      {clearHistoryErrorText}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                <span className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Default Working Directory
                </span>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={settingsForm.workingDirectory}
                    onChange={(event) =>
                      onSettingsFormChange({
                        workingDirectory: event.target.value
                      })
                    }
                    onBlur={onSettingsBlur}
                    placeholder="agent-workspace"
                    className="min-w-0 flex-1 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                  <button
                    type="button"
                    onClick={onChooseWorkingDirectory}
                    disabled={
                      loadingSettings ||
                      savingSettings ||
                      choosingWorkingDirectory
                    }
                    className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-3 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {choosingWorkingDirectory ? "选择中..." : "选择目录"}
                  </button>
                </div>
                <span className="text-xs leading-6 text-[var(--app-text-muted)]">
                  留空会回到 repo 根下的
                  `agent-workspace/`。可以直接输入绝对路径， 也可以选择 repo
                  外的目录作为默认 cwd。
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
                    className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
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
                    className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                </label>
              </div>

              <div className="grid gap-2">
                <div className={sectionHeadingClassName}>Execution</div>
                <label className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-secondary)]">
                  <div>
                    <div className="text-sm text-[var(--app-text-primary)]">
                      YOLO
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                      打开后，除 shell / network 外的工具都会直接执行； shell /
                      network 仍在运行时单独审批。
                    </div>
                  </div>
                  <WorkbenchSwitch
                    checked={settingsForm.yoloMode}
                    ariaLabel="切换 YOLO 默认设置"
                    onChange={onSettingsYoloModeChange}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-secondary)]">
                  <div>
                    <div className="text-sm text-[var(--app-text-primary)]">
                      调试对话视图
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                      显示完整 turns、thinking、工具调用和结果。
                    </div>
                  </div>
                  <WorkbenchSwitch
                    checked={settingsForm.debugConversationView}
                    ariaLabel="切换调试对话视图默认设置"
                    onChange={onSettingsDebugConversationViewChange}
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                    <span className={tertiaryHeadingClassName}>
                      Context Window
                    </span>
                    <input
                      value={settingsForm.contextWindow}
                      onChange={(event) =>
                        onSettingsFormChange({
                          contextWindow: event.target.value
                        })
                      }
                      onBlur={onSettingsBlur}
                      inputMode="numeric"
                      className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                    <span className={tertiaryHeadingClassName}>Max Turns</span>
                    <input
                      value={settingsForm.maxTurns}
                      onChange={(event) =>
                        onSettingsFormChange({ maxTurns: event.target.value })
                      }
                      onBlur={onSettingsBlur}
                      inputMode="numeric"
                      className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-3">
                <div className={sectionHeadingClassName}>Capabilities</div>
                <div className="grid gap-2">
                  {capabilityPackOptions.map((pack) => {
                    const checked =
                      settingsForm.enabledCapabilityPacks.includes(pack);
                    return (
                      <label
                        key={pack}
                        className="flex items-start gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-secondary)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onSettingsCapabilityPackToggle(pack)}
                          className="mt-1 h-4 w-4 accent-[var(--app-border-accent)]"
                        />
                        <div>
                          <div className="text-sm text-[var(--app-text-primary)]">
                            {formatCapabilityPackLabel(pack)}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                            {formatCapabilityPackDescription(pack)}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="grid gap-2">
                  <div className={tertiaryHeadingClassName}>
                    Tool Permission
                  </div>
                  <div className="text-xs leading-5 text-[var(--app-text-muted)]">
                    shell / network
                    不在这里配置。它们会在运行时按命令或请求单独确认。
                  </div>
                  {visiblePermissionTools.map((tool) => {
                    const pinnedByYolo = settingsForm.yoloMode;
                    const decision = pinnedByYolo
                      ? "allow"
                      : settingsForm.toolDenyList.includes(tool.name)
                        ? "deny"
                        : settingsForm.toolAllowList.includes(tool.name)
                          ? "allow"
                          : "ask";
                    return (
                      <div
                        key={tool.name}
                        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3"
                      >
                        <div>
                          <div className="text-sm text-[var(--app-text-primary)]">
                            {formatToolOptionLabel(tool.name)}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                            {pinnedByYolo
                              ? "YOLO 已启用，当前会话内固定允许。"
                              : tool.name}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(["allow", "ask", "deny"] as const).map((target) => (
                            <button
                              key={target}
                              type="button"
                              disabled={pinnedByYolo}
                              onClick={() =>
                                onSettingsPermissionToolToggle(
                                  tool.name,
                                  target
                                )
                              }
                              className={`rounded-[var(--app-radius-pill)] border px-3 py-1 text-xs transition ${
                                decision === target
                                  ? "border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] text-[var(--app-text-primary)]"
                                  : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                              }`}
                            >
                              {target}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="text-xs text-[var(--app-text-muted)]">
                {loadingSettings
                  ? "正在同步设置..."
                  : savingSettings
                    ? "正在保存设置..."
                    : pendingPermissionToolName
                      ? `最近处理权限：${getPermissionToolLabel(pendingPermissionToolName)}`
                      : settingsStatusText}
              </div>
            </div>
          ) : null}

          {activeSidebarPanel === "calendar" ? (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-[var(--app-text-primary)]">
                    当前工作周
                  </div>
                  <div className="mt-1 text-xs text-[var(--app-text-muted)]">
                    {currentSession?.context.currentDateContext ?? "--"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onResetAllRoutines}
                  disabled={resettingRoutines || submitting}
                  className="rounded-[var(--app-radius-pill)] border border-[var(--app-status-danger)] px-4 py-2 text-xs text-[var(--app-status-danger)] transition hover:bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resettingRoutines ? "重置中..." : "重置所有日程"}
                </button>
              </div>

              {weekDates.map((date) => (
                <div
                  key={date}
                  className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] px-4 py-4"
                >
                  <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                    {formatDayLabel(date)}
                  </div>
                  <div className="mt-3 grid gap-2">
                    {groupedRoutines.get(date)?.map((routine) => (
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
            <SessionWorkbenchInspector
              activeTab={activeTab}
              inspectorProjection={inspectorProjection}
              onSelectTab={onSelectTab}
            />
          ) : null}
        </div>
      </WorkbenchPanel>
    </div>
  );
}
