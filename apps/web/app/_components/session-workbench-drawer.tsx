"use client";

import type { ReactNode } from "react";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import type {
  RoutineRecord,
  SessionSnapshot,
  SettingsPermissionToolOption,
  UserContextHookRecord
} from "@ai-app-template/sdk";

import {
  capabilityPackOptions,
  MAX_TURNS_LIMIT,
  userContextHookBehaviorOptions,
  userContextHookContextEventOptions,
  userContextHookEventOptions,
  type InspectorTabId,
  type SettingsFormState,
  type SettingsMcpFormState,
  type SidebarPanelId
} from "./session-workbench-types";
import {
  formatDayLabel,
  getPermissionToolLabel,
  getSoftBlockClass,
  WorkbenchSelect,
  WorkbenchSwitch
} from "./session-workbench-shared";
import type { InspectorProjection } from "./session-message-manager";
import { SessionWorkbenchInspector } from "./session-workbench-inspector";

const sectionHeadingClassName =
  "text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]";
const tertiaryHeadingClassName =
  "text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]";
const sectionDividerClassName =
  "grid gap-3 border-t border-[color:color-mix(in_srgb,var(--app-border-subtle)_74%,transparent)] pt-5 first:border-t-0 first:pt-0";
const fieldRowClassName =
  "grid gap-3 sm:grid-cols-[minmax(0,176px)_1fr] sm:items-start";
const fieldLabelClassName = "grid gap-1 pr-2";
const fieldTitleClassName = "text-sm text-[var(--app-text-primary)]";
const fieldDescriptionClassName =
  "text-xs leading-5 text-[var(--app-text-muted)]";
const insetSurfaceClassName =
  "rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_86%,var(--app-bg-muted)_14%)]";

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
  return packName;
}

function formatCapabilityPackDescription(packName: string): string {
  if (packName === "workspace") {
    return "文件、搜索、shell 与网络等工作区能力。";
  }
  if (packName === "schedule") {
    return "日程创建、编辑、查询与冲突确认相关能力。";
  }
  return packName;
}

function formatMcpStatusLabel(
  status: SettingsMcpFormState["servers"][number]["status"]
): string {
  if (status === "loaded") {
    return "loaded";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "disabled") {
    return "disabled";
  }
  return "not checked";
}

function formatUserContextHookEventLabel(
  event: UserContextHookRecord["event"]
): string {
  if (event === "session_started") {
    return "Session Started";
  }
  if (event === "run_started") {
    return "Run Started";
  }
  return "Run End";
}

function getUserContextHookBehavior(
  hook: UserContextHookRecord
): NonNullable<UserContextHookRecord["behavior"]> {
  return hook.behavior ?? (hook.event === "run_end" ? "message" : "context");
}

function getUserContextHookEventOptions(hook: UserContextHookRecord) {
  return getUserContextHookBehavior(hook) === "context"
    ? userContextHookContextEventOptions
    : userContextHookEventOptions;
}

function formatUserContextHookBehaviorLabel(
  behavior: NonNullable<UserContextHookRecord["behavior"]>
): string {
  if (behavior === "context") {
    return "Context";
  }

  return "Send Message";
}

function formatUserContextHookBehaviorDescription(
  hook: UserContextHookRecord
): string {
  if (getUserContextHookBehavior(hook) === "context") {
    return "在 prompt runtime context 中注入。";
  }

  return "作为一条用户消息按时机执行。";
}

function formatUserContextHookEventDescription(
  event: UserContextHookRecord["event"]
): string {
  if (event === "session_started") {
    return "只在会话第一次 run 时触发。";
  }
  if (event === "run_started") {
    return "每次 run 开始时触发。";
  }
  return "用户消息完成后触发。";
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

function splitEditablePatternLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

interface DrawerSectionProps {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}

function DrawerSection({
  eyebrow,
  title,
  description,
  children
}: DrawerSectionProps) {
  return (
    <section className={sectionDividerClassName}>
      <div className="grid gap-1.5">
        <div className={sectionHeadingClassName}>{eyebrow}</div>
        <div className="text-base font-medium text-[var(--app-text-primary)]">
          {title}
        </div>
        {description ? (
          <div className="max-w-[44rem] text-sm leading-6 text-[var(--app-text-muted)]">
            {description}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

interface DrawerFieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}

function DrawerField({ label, description, children }: DrawerFieldProps) {
  return (
    <div className={fieldRowClassName}>
      <div className={fieldLabelClassName}>
        <div className={fieldTitleClassName}>{label}</div>
        {description ? (
          <div className={fieldDescriptionClassName}>{description}</div>
        ) : null}
      </div>
      <div className="grid gap-2.5">{children}</div>
    </div>
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
  settingsMcpForm: SettingsMcpFormState;
  permissionTools: SettingsPermissionToolOption[];
  loadingSettings: boolean;
  savingSettings: boolean;
  loadingMcpSettings: boolean;
  savingMcpSettings: boolean;
  mcpSettingsErrorText: string | null;
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
  onSettingsShellAllowPatternRemove: (pattern: string) => void;
  onAddMcpServer: () => void;
  onMcpServerChange: (
    serverId: string,
    patch: Partial<SettingsMcpFormState["servers"][number]>
  ) => void;
  onMcpServerTransportChange: (
    serverId: string,
    transport: SettingsMcpFormState["servers"][number]["transport"]
  ) => void;
  onMcpServerEnabledChange: (serverId: string, enabled: boolean) => void;
  onMcpToolEnabledChange: (
    serverId: string,
    toolName: string,
    enabled: boolean
  ) => void;
  onDeleteMcpServer: (serverId: string) => void;
  onMcpSettingsBlur: () => void;
  onAddUserContextHook: () => void;
  onUserContextHookChange: (
    hookId: string,
    patch: Partial<UserContextHookRecord>
  ) => void;
  onUserContextHookBlur: () => void;
  onUserContextHookEnabledChange: (hookId: string, enabled: boolean) => void;
  onUserContextHookEventChange: (
    hookId: string,
    event: UserContextHookRecord["event"]
  ) => void;
  onUserContextHookBehaviorChange: (
    hookId: string,
    behavior: NonNullable<UserContextHookRecord["behavior"]>
  ) => void;
  onDeleteUserContextHook: (hookId: string) => void;
  onMoveUserContextHook: (hookId: string, direction: "up" | "down") => void;
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
  settingsMcpForm,
  permissionTools,
  loadingSettings,
  savingSettings,
  loadingMcpSettings,
  savingMcpSettings,
  mcpSettingsErrorText,
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
  onSettingsShellAllowPatternRemove,
  onAddMcpServer,
  onMcpServerChange,
  onMcpServerTransportChange,
  onMcpServerEnabledChange,
  onMcpToolEnabledChange,
  onDeleteMcpServer,
  onMcpSettingsBlur,
  onAddUserContextHook,
  onUserContextHookChange,
  onUserContextHookBlur,
  onUserContextHookEnabledChange,
  onUserContextHookEventChange,
  onUserContextHookBehaviorChange,
  onDeleteUserContextHook,
  onMoveUserContextHook,
  headerActions
}: SessionWorkbenchDrawerProps) {
  if (!activeSidebarPanel) {
    return null;
  }

  const visiblePermissionTools = getVisiblePermissionTools(
    permissionTools,
    settingsForm.enabledCapabilityPacks
  );
  const shellAllowPatternLines = splitEditablePatternLines(
    settingsForm.shellAllowPatterns
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <WorkbenchPanel
        eyebrow={
          activeSidebarPanel === "settings"
            ? "Settings"
            : activeSidebarPanel === "hooks"
              ? "Hooks"
              : activeSidebarPanel === "calendar"
                ? "Calendar"
                : "Inspector"
        }
        title={
          activeSidebarPanel === "settings"
            ? "用户默认设置"
            : activeSidebarPanel === "hooks"
              ? "Hooks"
              : activeSidebarPanel === "calendar"
                ? "日程视图"
                : "调试详情"
        }
        meta={
          activeSidebarPanel === "settings"
            ? settingsMeta
            : activeSidebarPanel === "hooks"
              ? `${settingsForm.userContextHooks.filter((hook) => hook.enabled).length}/${settingsForm.userContextHooks.length} enabled`
              : activeSidebarPanel === "calendar"
                ? (currentSession?.context.currentDateContext ?? "--")
                : `${inspectorProjection.inspectorEvents.length} events`
        }
        headerActions={headerActions}
      >
        <div className="grid min-h-0 min-w-0 gap-5">
          {activeSidebarPanel === "settings" ? (
            <div className="grid gap-5">
              <div
                className={getSoftBlockClass(
                  "text-sm leading-6 text-[var(--app-text-secondary)]"
                )}
              >
                这里配置默认值。修改后会自动保存，后续新建会话会直接使用；当前会话的权限和
                yolo 也会同步更新。
              </div>

              {currentSession ? (
                <DrawerSection
                  eyebrow="Current Session"
                  title="当前会话"
                  description="这里显示当前会话已经生效的关键上下文，方便和默认设置区分开看。"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className={`${insetSurfaceClassName} px-4 py-3`}>
                      <div className={tertiaryHeadingClassName}>Model</div>
                      <div className="mt-2 break-all font-mono text-xs leading-6 text-[var(--app-text-primary)]">
                        {currentSession.model}
                      </div>
                    </div>
                    <div className={`${insetSurfaceClassName} px-4 py-3`}>
                      <div className={tertiaryHeadingClassName}>
                        Task Brief Path
                      </div>
                      <div className="mt-2 break-all font-mono text-xs leading-6 text-[var(--app-text-primary)]">
                        {currentSession.context.taskBriefPath ?? "--"}
                      </div>
                    </div>
                  </div>
                </DrawerSection>
              ) : null}

              {currentSession ? (
                <DrawerSection
                  eyebrow="History"
                  title="会话记录"
                  description="清空历史后会重新开始，但默认设置会保留。"
                >
                  <DrawerField
                    label="清除历史"
                    description="删除所有会话记录，仅保留当前默认设置。"
                  >
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
                    {clearHistoryErrorText ? (
                      <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-6 text-[var(--app-status-danger)]">
                        {clearHistoryErrorText}
                      </div>
                    ) : null}
                  </DrawerField>
                </DrawerSection>
              ) : null}

              <DrawerSection
                eyebrow="Workspace"
                title="默认工作目录"
                description="新会话会从这里启动；留空时仍回到仓库内的默认工作区。"
              >
                <DrawerField
                  label="Working Directory"
                  description="支持直接输入绝对路径，也可以用目录选择器挑选 repo 外的位置。"
                >
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
                  <div className={fieldDescriptionClassName}>
                    留空会回到 repo 根下的 `agent-workspace/`。
                  </div>
                </DrawerField>
              </DrawerSection>

              <DrawerSection
                eyebrow="MCP"
                title="MCP 服务与工具"
                description="管理当前默认工作目录下的 MCP server，并选择本轮运行可挂载的子工具。"
              >
                <div className="grid gap-3">
                  <div className={`${insetSurfaceClassName} px-4 py-3`}>
                    <div className={tertiaryHeadingClassName}>Config Path</div>
                    <div className="mt-2 break-all font-mono text-xs leading-6 text-[var(--app-text-primary)]">
                      {settingsMcpForm.configPath || "--"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                      {loadingMcpSettings
                        ? "正在读取 MCP 配置..."
                        : settingsMcpForm.foundConfig
                          ? "已找到配置文件。"
                          : "还没有 MCP 配置文件。"}
                    </div>
                  </div>

                  {settingsMcpForm.diagnostics.length > 0 ? (
                    <div className="grid gap-2">
                      {settingsMcpForm.diagnostics.map((diagnostic, index) => (
                        <div
                          key={`${diagnostic.code}-${diagnostic.serverName ?? "file"}-${index}`}
                          className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--app-status-danger)]"
                        >
                          {diagnostic.serverName
                            ? `${diagnostic.serverName}: ${diagnostic.message}`
                            : diagnostic.message}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between gap-3">
                    <div className={sectionHeadingClassName}>Servers</div>
                    <button
                      type="button"
                      onClick={onAddMcpServer}
                      disabled={loadingMcpSettings || savingMcpSettings}
                      className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add Server
                    </button>
                  </div>

                  {settingsMcpForm.servers.length === 0 ? (
                    <div
                      className={`${insetSurfaceClassName} px-4 py-3 text-xs leading-5 text-[var(--app-text-muted)]`}
                    >
                      当前工作目录还没有 MCP server。
                    </div>
                  ) : (
                    settingsMcpForm.servers.map((server) => (
                      <div
                        key={server.id}
                        className="grid gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <input
                              value={server.name}
                              onChange={(event) =>
                                onMcpServerChange(server.id, {
                                  name: event.target.value
                                })
                              }
                              onBlur={onMcpSettingsBlur}
                              placeholder="server name"
                              className="w-full min-w-0 border-none bg-transparent px-0 py-0 text-sm text-[var(--app-text-primary)] outline-none placeholder:text-[var(--app-text-muted)]"
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-[var(--app-text-muted)]">
                              <span>{server.transport}</span>
                              <span>·</span>
                              <span>{formatMcpStatusLabel(server.status)}</span>
                              <span>·</span>
                              <span>
                                {
                                  server.tools.filter((tool) => tool.enabled)
                                    .length
                                }
                                /{server.tools.length} tools
                              </span>
                            </div>
                          </div>
                          <WorkbenchSwitch
                            checked={server.enabled}
                            disabled={loadingMcpSettings || savingMcpSettings}
                            ariaLabel={`切换 ${server.name || "MCP server"} 的启用状态`}
                            onChange={(checked) =>
                              onMcpServerEnabledChange(server.id, checked)
                            }
                          />
                        </div>

                        {server.error ? (
                          <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--app-status-danger)]">
                            {server.error}
                          </div>
                        ) : null}

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,160px)_1fr] sm:items-center">
                          <div className={tertiaryHeadingClassName}>
                            Transport
                          </div>
                          <WorkbenchSelect
                            value={server.transport}
                            disabled={loadingMcpSettings || savingMcpSettings}
                            ariaLabel="选择 MCP transport"
                            options={[
                              { value: "stdio", label: "stdio" },
                              { value: "http", label: "http" }
                            ]}
                            onValueChange={(transport) =>
                              onMcpServerTransportChange(
                                server.id,
                                transport as SettingsMcpFormState["servers"][number]["transport"]
                              )
                            }
                          />
                        </div>

                        {server.transport === "stdio" ? (
                          <div className="grid gap-3">
                            <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                              <span className={tertiaryHeadingClassName}>
                                Command
                              </span>
                              <input
                                value={server.command}
                                onChange={(event) =>
                                  onMcpServerChange(server.id, {
                                    command: event.target.value
                                  })
                                }
                                onBlur={onMcpSettingsBlur}
                                className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                              />
                            </label>
                            <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                              <span className={tertiaryHeadingClassName}>
                                Args
                              </span>
                              <textarea
                                value={server.args}
                                onChange={(event) =>
                                  onMcpServerChange(server.id, {
                                    args: event.target.value
                                  })
                                }
                                onBlur={onMcpSettingsBlur}
                                rows={2}
                                className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                              />
                            </label>
                            <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                              <span className={tertiaryHeadingClassName}>
                                Env
                              </span>
                              <textarea
                                value={server.env}
                                onChange={(event) =>
                                  onMcpServerChange(server.id, {
                                    env: event.target.value
                                  })
                                }
                                onBlur={onMcpSettingsBlur}
                                rows={2}
                                className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                              <span className={tertiaryHeadingClassName}>
                                URL
                              </span>
                              <input
                                value={server.url}
                                onChange={(event) =>
                                  onMcpServerChange(server.id, {
                                    url: event.target.value
                                  })
                                }
                                onBlur={onMcpSettingsBlur}
                                className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                              />
                            </label>
                            <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                              <span className={tertiaryHeadingClassName}>
                                Headers
                              </span>
                              <textarea
                                value={server.headers}
                                onChange={(event) =>
                                  onMcpServerChange(server.id, {
                                    headers: event.target.value
                                  })
                                }
                                onBlur={onMcpSettingsBlur}
                                rows={2}
                                className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                              />
                            </label>
                          </div>
                        )}

                        <div className="grid gap-2">
                          <div className={tertiaryHeadingClassName}>Tools</div>
                          {server.tools.length === 0 ? (
                            <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--app-text-muted)]">
                              {server.status === "disabled"
                                ? "server 已关闭，启用后会刷新子工具列表。"
                                : "还没有可列出的子工具。"}
                            </div>
                          ) : (
                            server.tools.map((tool) => (
                              <label
                                key={tool.runtimeName}
                                className="flex items-start justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="break-all font-mono text-xs text-[var(--app-text-primary)]">
                                    {tool.name}
                                  </div>
                                  <div className="mt-1 break-all text-xs leading-5 text-[var(--app-text-muted)]">
                                    {tool.description ?? tool.runtimeName}
                                  </div>
                                </div>
                                <WorkbenchSwitch
                                  checked={tool.enabled}
                                  disabled={
                                    loadingMcpSettings || savingMcpSettings
                                  }
                                  ariaLabel={`切换 MCP tool ${tool.name} 的启用状态`}
                                  onChange={(checked) =>
                                    onMcpToolEnabledChange(
                                      server.id,
                                      tool.name,
                                      checked
                                    )
                                  }
                                />
                              </label>
                            ))
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-[var(--app-text-muted)]">
                            {savingMcpSettings
                              ? "正在保存 MCP 设置..."
                              : "保存后下一次 run 生效"}
                          </div>
                          <button
                            type="button"
                            onClick={() => onDeleteMcpServer(server.id)}
                            disabled={loadingMcpSettings || savingMcpSettings}
                            className="rounded-[var(--app-radius-pill)] border border-[var(--app-status-danger)] px-3 py-1 text-xs text-[var(--app-status-danger)] transition hover:bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}

                  {mcpSettingsErrorText ? (
                    <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--app-status-danger)]">
                      {mcpSettingsErrorText}
                    </div>
                  ) : null}
                </div>
              </DrawerSection>

              <DrawerSection
                eyebrow="Shell Permission"
                title="Shell 权限"
                description="把常见命令模式放进 allow 或 deny，运行时就不会每次都从头判断。"
              >
                <DrawerField
                  label="Allow Patterns"
                  description="每行一条规则，保存后会作为默认允许模式。"
                >
                  {shellAllowPatternLines.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {shellAllowPatternLines.map((pattern) => (
                        <span
                          key={pattern}
                          className="inline-flex max-w-full items-center gap-2 rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-1.5 text-xs text-[var(--app-text-secondary)]"
                        >
                          <span className="min-w-0 break-all font-mono">
                            {pattern}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onSettingsShellAllowPatternRemove(pattern)
                            }
                            disabled={loadingSettings || savingSettings}
                            className="shrink-0 text-[var(--app-text-muted)] transition hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            移除
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`${insetSurfaceClassName} px-4 py-3 text-xs leading-5 text-[var(--app-text-muted)]`}
                    >
                      还没有保存的 allow patterns。
                    </div>
                  )}
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
                </DrawerField>
                <DrawerField
                  label="Deny Patterns"
                  description="每行一条规则，命中后会直接阻止执行。"
                >
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
                </DrawerField>
              </DrawerSection>

              <DrawerSection
                eyebrow="Execution"
                title="执行行为"
                description="这里控制默认执行方式、上下文预算，以及调试信息的展示深度。"
              >
                <DrawerField
                  label="Runtime Toggles"
                  description="这两项会影响新会话默认的执行与展示方式。"
                >
                  <label
                    className={`flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--app-text-secondary)] ${insetSurfaceClassName}`}
                  >
                    <div>
                      <div className="text-sm text-[var(--app-text-primary)]">
                        YOLO
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                        打开后，除 shell / network 外的工具都会直接执行；shell /
                        network 仍在运行时单独审批。
                      </div>
                    </div>
                    <WorkbenchSwitch
                      checked={settingsForm.yoloMode}
                      ariaLabel="切换 YOLO 默认设置"
                      onChange={onSettingsYoloModeChange}
                    />
                  </label>

                  <label
                    className={`flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--app-text-secondary)] ${insetSurfaceClassName}`}
                  >
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
                </DrawerField>

                <DrawerField
                  label="Budget"
                  description={`为长上下文和连续多轮预留默认预算；Max Turns 上限为 ${MAX_TURNS_LIMIT}。`}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
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
                      <span className={tertiaryHeadingClassName}>
                        Max Turns
                      </span>
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
                </DrawerField>
              </DrawerSection>

              <DrawerSection
                eyebrow="Custom Prompt"
                title="长期提示"
                description="适合放长期偏好、回答约束或固定执行提醒。"
              >
                <DrawerField
                  label="Prompt"
                  description="保存后会在下一次 run 生效。"
                >
                  <textarea
                    value={settingsForm.userCustomPrompt}
                    onChange={(event) =>
                      onSettingsFormChange({
                        userCustomPrompt: event.target.value
                      })
                    }
                    onBlur={onSettingsBlur}
                    rows={6}
                    placeholder="写一段长期有效的偏好、回答约束或执行提醒。"
                    className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                </DrawerField>
              </DrawerSection>

              <DrawerSection
                eyebrow="Capabilities"
                title="能力与工具权限"
                description="先决定默认启用哪些能力包，再细调各工具的默认询问策略。"
              >
                <DrawerField
                  label="Capability Packs"
                  description="只显示当前启用能力包对应的工具权限配置。"
                >
                  <div className="grid gap-2">
                    {capabilityPackOptions.map((pack) => {
                      const checked =
                        settingsForm.enabledCapabilityPacks.includes(pack);
                      return (
                        <label
                          key={pack}
                          className={`flex items-start gap-3 px-4 py-3 text-sm text-[var(--app-text-secondary)] ${insetSurfaceClassName}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              onSettingsCapabilityPackToggle(pack)
                            }
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
                </DrawerField>
                <DrawerField
                  label="Tool Permission"
                  description="shell / network 不在这里配置，它们会在运行时按命令或请求单独确认。"
                >
                  {visiblePermissionTools.length === 0 ? (
                    <div
                      className={`${insetSurfaceClassName} px-4 py-3 text-xs leading-5 text-[var(--app-text-muted)]`}
                    >
                      当前没有需要单独配置的工具权限。
                    </div>
                  ) : (
                    visiblePermissionTools.map((tool) => {
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
                          className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${insetSurfaceClassName}`}
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
                          <div className="flex flex-wrap items-center gap-2">
                            {(["allow", "ask", "deny"] as const).map(
                              (target) => (
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
                              )
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </DrawerField>
              </DrawerSection>

              <div className="rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] px-4 py-3 text-xs text-[var(--app-text-muted)]">
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

          {activeSidebarPanel === "hooks" ? (
            <div className="grid gap-3">
              <div
                className={getSoftBlockClass(
                  "text-sm leading-6 text-[var(--app-text-secondary)]"
                )}
              >
                为不同 runtime 时机配置 context
                注入或自动发送消息。修改后会自动保存，并在下一次 run 生效。
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className={sectionHeadingClassName}>Hook List</div>
                <button
                  type="button"
                  onClick={onAddUserContextHook}
                  disabled={savingSettings}
                  className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Hook
                </button>
              </div>

              {settingsForm.userContextHooks.length === 0 ? (
                <div
                  className={getSoftBlockClass(
                    "text-sm leading-6 text-[var(--app-text-muted)]"
                  )}
                >
                  还没有 hooks。先加一条 run_started 试试。
                </div>
              ) : (
                <div className="grid gap-3">
                  {settingsForm.userContextHooks.map((hook, index) => (
                    <div
                      key={hook.id}
                      className="grid gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <input
                            value={hook.title}
                            onChange={(event) =>
                              onUserContextHookChange(hook.id, {
                                title: event.target.value
                              })
                            }
                            onBlur={onUserContextHookBlur}
                            placeholder="Hook title"
                            className="w-full min-w-0 border-none bg-transparent px-0 py-0 text-sm text-[var(--app-text-primary)] outline-none placeholder:text-[var(--app-text-muted)]"
                          />
                          <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                            {formatUserContextHookBehaviorDescription(hook)}{" "}
                            {formatUserContextHookEventDescription(hook.event)}
                          </div>
                        </div>
                        <WorkbenchSwitch
                          checked={hook.enabled}
                          disabled={savingSettings}
                          ariaLabel={`切换 ${hook.title || "hook"} 的启用状态`}
                          onChange={(checked) =>
                            onUserContextHookEnabledChange(hook.id, checked)
                          }
                        />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
                        <div className={tertiaryHeadingClassName}>Behavior</div>
                        <WorkbenchSelect
                          value={getUserContextHookBehavior(hook)}
                          disabled={savingSettings}
                          ariaLabel="选择 hook 行为"
                          options={userContextHookBehaviorOptions.map(
                            (behavior) => ({
                              value: behavior,
                              label:
                                formatUserContextHookBehaviorLabel(behavior)
                            })
                          )}
                          onValueChange={(behavior) =>
                            onUserContextHookBehaviorChange(
                              hook.id,
                              behavior as NonNullable<
                                UserContextHookRecord["behavior"]
                              >
                            )
                          }
                        />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
                        <div className={tertiaryHeadingClassName}>Event</div>
                        <WorkbenchSelect
                          value={hook.event}
                          disabled={savingSettings}
                          ariaLabel="选择 hook 触发时机"
                          options={getUserContextHookEventOptions(hook).map(
                            (event) => ({
                              value: event,
                              label: formatUserContextHookEventLabel(event)
                            })
                          )}
                          onValueChange={(event) =>
                            onUserContextHookEventChange(
                              hook.id,
                              event as UserContextHookRecord["event"]
                            )
                          }
                        />
                      </div>

                      <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                        <span className={tertiaryHeadingClassName}>
                          Content
                        </span>
                        <textarea
                          value={hook.content}
                          onChange={(event) =>
                            onUserContextHookChange(hook.id, {
                              content: event.target.value
                            })
                          }
                          onBlur={onUserContextHookBlur}
                          rows={5}
                          placeholder="写入要在该时机注入的用户 context"
                          className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                        />
                      </label>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                          #{index + 1}
                        </div>
                        <button
                          type="button"
                          onClick={() => onMoveUserContextHook(hook.id, "up")}
                          disabled={savingSettings || index === 0}
                          className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-xs text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveUserContextHook(hook.id, "down")}
                          disabled={
                            savingSettings ||
                            index === settingsForm.userContextHooks.length - 1
                          }
                          className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-xs text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteUserContextHook(hook.id)}
                          disabled={savingSettings}
                          className="rounded-[var(--app-radius-pill)] border border-[var(--app-status-danger)] px-3 py-1 text-xs text-[var(--app-status-danger)] transition hover:bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-[var(--app-text-muted)]">
                {loadingSettings
                  ? "正在同步 hooks..."
                  : savingSettings
                    ? "正在保存 hooks..."
                    : "修改会自动保存，并在当前会话的下一次 run 生效"}
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
