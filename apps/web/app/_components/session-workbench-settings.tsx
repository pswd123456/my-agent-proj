"use client";

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import type {
  SessionSnapshot,
  SettingsPermissionToolOption,
  UserContextHookRecord
} from "@ai-app-template/sdk";

import {
  capabilityPackOptions,
  MAX_TURNS_LIMIT,
  settingsPages,
  userContextHookBehaviorOptions,
  userContextHookContextEventOptions,
  userContextHookEventOptions,
  type SettingsFormState,
  type SettingsMcpFormState,
  type SettingsSkillsState,
  type SettingsPageId
} from "./session-workbench-types";
import {
  getPermissionToolLabel,
  getSoftBlockClass,
  WorkbenchSelect,
  WorkbenchSwitch
} from "./session-workbench-shared";

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

function ArrowLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.75 3.5 6.25 8l4.5 4.5" />
      <path d="M6.75 8h6.75" />
    </svg>
  );
}

function ChevronDownIcon({
  expanded = false
}: {
  expanded?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5 8 10l4-3.5" />
    </svg>
  );
}

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

function formatMcpToolDescription(
  description: string | null,
  runtimeName: string
): string {
  const text = description?.trim();
  if (!text) {
    return runtimeName;
  }
  const firstPeriodIndex = text.indexOf(".");
  if (firstPeriodIndex < 0) {
    return text;
  }
  return text.slice(0, firstPeriodIndex + 1);
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

function isWorkspaceSkillEnabled(
  settingsForm: SettingsFormState,
  skillName: string
): boolean {
  const override = settingsForm.workspaceSkillSettings.find(
    (setting) => setting.skillName === skillName
  );
  return override ? override.enabled : true;
}

interface SettingsSectionProps {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}

function SettingsSection({
  eyebrow,
  title,
  description,
  children
}: SettingsSectionProps) {
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

interface SettingsFieldProps {
  label: string;
  description?: string;
  children: ReactNode;
}

function SettingsField({ label, description, children }: SettingsFieldProps) {
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

interface SessionWorkbenchSettingsProps {
  activeSettingsPage: SettingsPageId;
  currentSession: SessionSnapshot | null;
  settingsMeta: string;
  settingsStatusText: string;
  settingsForm: SettingsFormState;
  settingsMcpForm: SettingsMcpFormState;
  settingsSkillsState: SettingsSkillsState;
  permissionTools: SettingsPermissionToolOption[];
  loadingSettings: boolean;
  savingSettings: boolean;
  loadingMcpSettings: boolean;
  loadingSkillsSettings: boolean;
  savingMcpSettings: boolean;
  mcpSettingsErrorText: string | null;
  clearingSessionHistory: boolean;
  clearHistoryErrorText: string | null;
  choosingWorkingDirectory: boolean;
  pendingPermissionToolName: string | null;
  onReturnToApp: () => void;
  onSelectSettingsPage: (pageId: SettingsPageId) => void;
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
  onSettingsSkillEnabledChange: (skillName: string, enabled: boolean) => void;
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
}

export function SessionWorkbenchSettings({
  activeSettingsPage,
  currentSession,
  settingsMeta,
  settingsStatusText,
  settingsForm,
  settingsMcpForm,
  settingsSkillsState,
  permissionTools,
  loadingSettings,
  savingSettings,
  loadingMcpSettings,
  loadingSkillsSettings,
  savingMcpSettings,
  mcpSettingsErrorText,
  clearingSessionHistory,
  clearHistoryErrorText,
  choosingWorkingDirectory,
  pendingPermissionToolName,
  onReturnToApp,
  onSelectSettingsPage,
  onSettingsFormChange,
  onSettingsBlur,
  onChooseWorkingDirectory,
  onClearSessionHistory,
  onSettingsYoloModeChange,
  onSettingsDebugConversationViewChange,
  onSettingsPermissionToolToggle,
  onSettingsCapabilityPackToggle,
  onSettingsShellAllowPatternRemove,
  onSettingsSkillEnabledChange,
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
  onMoveUserContextHook
}: SessionWorkbenchSettingsProps) {
  const [expandedMcpServerIds, setExpandedMcpServerIds] = useState<Set<string>>(
    () => new Set()
  );
  const [expandedMcpConfigIds, setExpandedMcpConfigIds] = useState<Set<string>>(
    () => new Set()
  );
  const [expandedMcpToolIds, setExpandedMcpToolIds] = useState<Set<string>>(
    () => new Set()
  );
  const page = settingsPages.find((item) => item.id === activeSettingsPage);
  const visiblePermissionTools = getVisiblePermissionTools(
    permissionTools,
    settingsForm.enabledCapabilityPacks
  );
  const shellAllowPatternLines = splitEditablePatternLines(
    settingsForm.shellAllowPatterns
  );
  const hooksEnabledCount = settingsForm.userContextHooks.filter(
    (hook) => hook.enabled
  ).length;
  const enabledWorkspaceSkillCount = settingsSkillsState.skills.filter((skill) =>
    isWorkspaceSkillEnabled(settingsForm, skill.name)
  ).length;
  const statusText = loadingSettings
    ? "正在同步设置..."
    : savingSettings
      ? "正在保存设置..."
        : pendingPermissionToolName
          ? `最近处理权限：${getPermissionToolLabel(pendingPermissionToolName)}`
          : settingsStatusText;

  function toggleExpandedId(
    setExpanded: Dispatch<SetStateAction<Set<string>>>,
    id: string
  ) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function renderGeneralPage() {
    return (
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
          <SettingsSection
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
                <div className={tertiaryHeadingClassName}>Task Brief Path</div>
                <div className="mt-2 break-all font-mono text-xs leading-6 text-[var(--app-text-primary)]">
                  {currentSession.context.taskBriefPath ?? "--"}
                </div>
              </div>
            </div>
          </SettingsSection>
        ) : null}

        {currentSession ? (
          <SettingsSection
            eyebrow="History"
            title="会话记录"
            description="清空历史后会重新开始，但默认设置会保留。"
          >
            <SettingsField
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
            </SettingsField>
          </SettingsSection>
        ) : null}

        <SettingsSection
          eyebrow="Workspace"
          title="默认工作目录"
          description="新会话会从这里启动；留空时仍回到仓库内的默认工作区。"
        >
          <SettingsField
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
                  loadingSettings || savingSettings || choosingWorkingDirectory
                }
                className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-3 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {choosingWorkingDirectory ? "选择中..." : "选择目录"}
              </button>
            </div>
            <div className={fieldDescriptionClassName}>
              留空会回到 repo 根下的 `agent-workspace/`。
            </div>
          </SettingsField>
        </SettingsSection>

        <SettingsSection
          eyebrow="Execution"
          title="执行行为"
          description="这里控制默认执行方式、上下文预算，以及调试信息的展示深度。"
        >
          <SettingsField
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
          </SettingsField>

          <SettingsField
            label="Budget"
            description={`为长上下文和连续多轮预留默认预算；Max Turns 上限为 ${MAX_TURNS_LIMIT}。`}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                <span className={tertiaryHeadingClassName}>Context Window</span>
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
          </SettingsField>
        </SettingsSection>
      </div>
    );
  }

  function renderPermissionsPage() {
    return (
      <div className="grid gap-5">
        <div
          className={getSoftBlockClass(
            "text-sm leading-6 text-[var(--app-text-secondary)]"
          )}
        >
          先决定默认启用哪些能力，再保存常见的 shell 规则和工具询问策略。
        </div>

        <SettingsSection
          eyebrow="Shell Permission"
          title="Shell 权限"
          description="把常见命令模式放进 allow 或 deny，运行时就不会每次都从头判断。"
        >
          <SettingsField
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
                      onClick={() => onSettingsShellAllowPatternRemove(pattern)}
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
          </SettingsField>
          <SettingsField
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
          </SettingsField>
        </SettingsSection>

        <SettingsSection
          eyebrow="Capabilities"
          title="能力与工具权限"
          description="先决定默认启用哪些能力包，再细调各工具的默认询问策略。"
        >
          <SettingsField
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
          </SettingsField>
          <SettingsField
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
                      {(["allow", "ask", "deny"] as const).map((target) => (
                        <button
                          key={target}
                          type="button"
                          disabled={pinnedByYolo}
                          onClick={() =>
                            onSettingsPermissionToolToggle(tool.name, target)
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
              })
            )}
          </SettingsField>
        </SettingsSection>
      </div>
    );
  }

  function renderMcpPage() {
    return (
      <div className="grid gap-5">
        <div
          className={getSoftBlockClass(
            "text-sm leading-6 text-[var(--app-text-secondary)]"
          )}
        >
          管理当前工作目录下的 MCP server。
        </div>

        <SettingsSection
          eyebrow="MCP"
          title="MCP 服务与工具"
          description="默认折叠，保存后下一次 run 生效。"
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
                  <div className="flex items-center justify-between gap-3">
                    <input
                      value={server.name}
                      onChange={(event) =>
                        onMcpServerChange(server.id, {
                          name: event.target.value
                        })
                      }
                      onBlur={onMcpSettingsBlur}
                      placeholder="server name"
                      className="min-w-0 flex-1 border-none bg-transparent px-0 py-0 text-sm text-[var(--app-text-primary)] outline-none placeholder:text-[var(--app-text-muted)]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        toggleExpandedId(setExpandedMcpServerIds, server.id)
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)]"
                      aria-label={`${expandedMcpServerIds.has(server.id) ? "收起" : "展开"} ${server.name || "MCP server"}`}
                      aria-expanded={expandedMcpServerIds.has(server.id)}
                    >
                      <ChevronDownIcon
                        expanded={expandedMcpServerIds.has(server.id)}
                      />
                    </button>
                  </div>

                  {expandedMcpServerIds.has(server.id) ? (
                    <>
                      {server.error ? (
                        <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--app-status-danger)]">
                          {server.error}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-3 text-xs leading-5 text-[var(--app-text-muted)]">
                        <span>{server.transport}</span>
                        <span>{formatMcpStatusLabel(server.status)}</span>
                        <span>
                          {server.tools.filter((tool) => tool.enabled).length}/
                          {server.tools.length} tools
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <span>启用</span>
                          <WorkbenchSwitch
                            checked={server.enabled}
                            disabled={loadingMcpSettings || savingMcpSettings}
                            ariaLabel={`切换 ${server.name || "MCP server"} 的启用状态`}
                            onChange={(checked) =>
                              onMcpServerEnabledChange(server.id, checked)
                            }
                          />
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            toggleExpandedId(setExpandedMcpConfigIds, server.id)
                          }
                          className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_48%,transparent)] px-3 py-2 text-left"
                          aria-expanded={expandedMcpConfigIds.has(server.id)}
                        >
                          <div>
                            <div className={tertiaryHeadingClassName}>
                              具体设置
                            </div>
                            <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                              transport 与连接参数
                            </div>
                          </div>
                          <ChevronDownIcon
                            expanded={expandedMcpConfigIds.has(server.id)}
                          />
                        </button>

                        {expandedMcpConfigIds.has(server.id) ? (
                          <>
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
                          </>
                        ) : null}
                      </div>

                      <div className="grid gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            toggleExpandedId(setExpandedMcpToolIds, server.id)
                          }
                          className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_48%,transparent)] px-3 py-2 text-left"
                          aria-expanded={expandedMcpToolIds.has(server.id)}
                        >
                          <div>
                            <div className={tertiaryHeadingClassName}>
                              工具列表
                            </div>
                            <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                              {server.tools.filter((tool) => tool.enabled).length}/
                              {server.tools.length} 已启用
                            </div>
                          </div>
                          <ChevronDownIcon
                            expanded={expandedMcpToolIds.has(server.id)}
                          />
                        </button>

                        {expandedMcpToolIds.has(server.id) ? (
                          server.tools.length === 0 ? (
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
                                    {formatMcpToolDescription(
                                      tool.description,
                                      tool.runtimeName
                                    )}
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
                          )
                        ) : null}
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
                    </>
                  ) : null}
                </div>
              ))
            )}

            {mcpSettingsErrorText ? (
              <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--app-status-danger)]">
                {mcpSettingsErrorText}
              </div>
            ) : null}
          </div>
        </SettingsSection>
      </div>
    );
  }

  function renderSkillsPage() {
    return (
      <div className="grid gap-5">
        <div
          className={getSoftBlockClass(
            "text-sm leading-6 text-[var(--app-text-secondary)]"
          )}
        >
          控制当前工作目录下哪些 skills 会进入 runtime context，也会影响
          search_skill / load_skill 的可见范围。修改后下一次 run 生效。
        </div>

        <SettingsSection
          eyebrow="Workspace Skills"
          title="Skill 列表"
          description="未显式配置的 skill 默认保持启用。"
        >
          <div className="grid gap-3">
            <div className={`${insetSurfaceClassName} px-4 py-3`}>
              <div className={tertiaryHeadingClassName}>Working Directory</div>
              <div className="mt-2 break-all font-mono text-xs leading-6 text-[var(--app-text-primary)]">
                {settingsSkillsState.workingDirectory || "--"}
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                {loadingSkillsSettings
                  ? "正在读取 skill 列表..."
                  : `${enabledWorkspaceSkillCount}/${settingsSkillsState.skills.length} enabled`}
              </div>
            </div>

            {settingsSkillsState.diagnostics.length > 0 ? (
              <div className="grid gap-2">
                {settingsSkillsState.diagnostics.map((diagnostic, index) => (
                  <div
                    key={`${diagnostic.relativePath}-${diagnostic.reason}-${index}`}
                    className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)]/40 bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--app-status-danger)]"
                  >
                    {diagnostic.relativePath}: {diagnostic.message}
                  </div>
                ))}
              </div>
            ) : null}

            {settingsSkillsState.skills.length === 0 ? (
              <div
                className={getSoftBlockClass(
                  "text-sm leading-6 text-[var(--app-text-muted)]"
                )}
              >
                {loadingSkillsSettings
                  ? "正在发现当前工作目录下的 skills。"
                  : "当前工作目录还没有发现可管理的 skills。"}
              </div>
            ) : (
              <div className="grid gap-3">
                {settingsSkillsState.skills.map((skill) => {
                  const enabled = isWorkspaceSkillEnabled(
                    settingsForm,
                    skill.name
                  );
                  return (
                    <label
                      key={skill.relativePath}
                      className={`flex items-start justify-between gap-3 px-4 py-3 ${insetSurfaceClassName}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-[var(--app-text-primary)]">
                          {skill.name}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                          {skill.description}
                        </div>
                        <div className="mt-2 break-all font-mono text-[11px] leading-5 text-[var(--app-text-muted)]">
                          {skill.relativePath}
                        </div>
                      </div>
                      <WorkbenchSwitch
                        checked={enabled}
                        disabled={savingSettings}
                        ariaLabel={`切换 skill ${skill.name} 的启用状态`}
                        onChange={(checked) =>
                          onSettingsSkillEnabledChange(skill.name, checked)
                        }
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </SettingsSection>
      </div>
    );
  }

  function renderHooksPage() {
    return (
      <div className="grid gap-5">
        <div
          className={getSoftBlockClass(
            "text-sm leading-6 text-[var(--app-text-secondary)]"
          )}
        >
          为不同 runtime 时机配置 context
          注入或自动发送消息。修改后会自动保存，并在下一次 run 生效。
        </div>

        <SettingsSection
          eyebrow="Hooks"
          title="Hook 列表"
          description="一条 hook 只负责一个固定时机，保持稳定、可复用。"
        >
          <div className="flex items-center justify-between gap-3">
            <div className={sectionHeadingClassName}>
              {hooksEnabledCount}/{settingsForm.userContextHooks.length} enabled
            </div>
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
                        placeholder="hook title"
                        className="w-full min-w-0 border-none bg-transparent px-0 py-0 text-sm text-[var(--app-text-primary)] outline-none placeholder:text-[var(--app-text-muted)]"
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs leading-5 text-[var(--app-text-muted)]">
                        <span>
                          {formatUserContextHookBehaviorLabel(
                            getUserContextHookBehavior(hook)
                          )}
                        </span>
                        <span>·</span>
                        <span>
                          {formatUserContextHookEventLabel(hook.event)}
                        </span>
                        <span>·</span>
                        <span>{hook.enabled ? "enabled" : "disabled"}</span>
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

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                      <span className={tertiaryHeadingClassName}>Behavior</span>
                      <WorkbenchSelect
                        value={getUserContextHookBehavior(hook)}
                        disabled={savingSettings}
                        ariaLabel="选择 hook 行为"
                        options={userContextHookBehaviorOptions.map(
                          (option) => ({
                            value: option,
                            label: formatUserContextHookBehaviorLabel(option)
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
                      <div className={fieldDescriptionClassName}>
                        {formatUserContextHookBehaviorDescription(hook)}
                      </div>
                    </label>
                    <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                      <span className={tertiaryHeadingClassName}>Event</span>
                      <WorkbenchSelect
                        value={hook.event}
                        disabled={savingSettings}
                        ariaLabel="选择 hook 触发时机"
                        options={getUserContextHookEventOptions(hook).map(
                          (option) => ({
                            value: option,
                            label: formatUserContextHookEventLabel(option)
                          })
                        )}
                        onValueChange={(event) =>
                          onUserContextHookEventChange(
                            hook.id,
                            event as UserContextHookRecord["event"]
                          )
                        }
                      />
                      <div className={fieldDescriptionClassName}>
                        {formatUserContextHookEventDescription(hook.event)}
                      </div>
                    </label>
                  </div>

                  <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                    <span className={tertiaryHeadingClassName}>Content</span>
                    <textarea
                      value={hook.content}
                      onChange={(event) =>
                        onUserContextHookChange(hook.id, {
                          content: event.target.value
                        })
                      }
                      onBlur={onUserContextHookBlur}
                      rows={5}
                      className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                    />
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onMoveUserContextHook(hook.id, "up")}
                        disabled={savingSettings || index === 0}
                        className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-xs text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        上移
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
                        下移
                      </button>
                    </div>
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
        </SettingsSection>
      </div>
    );
  }

  function renderPersonalizationPage() {
    return (
      <div className="grid gap-5">
        <div
          className={getSoftBlockClass(
            "text-sm leading-6 text-[var(--app-text-secondary)]"
          )}
        >
          这里保留长期有效的偏好、回答约束与固定执行提醒，减少每次重新声明。
        </div>

        <SettingsSection
          eyebrow="Custom Prompt"
          title="长期提示"
          description="适合放长期偏好、回答约束或固定执行提醒。"
        >
          <SettingsField
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
              rows={8}
              placeholder="写一段长期有效的偏好、回答约束或执行提醒。"
              className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
            />
          </SettingsField>
        </SettingsSection>
      </div>
    );
  }

  function renderPageContent() {
    if (activeSettingsPage === "permissions") {
      return renderPermissionsPage();
    }
    if (activeSettingsPage === "mcp") {
      return renderMcpPage();
    }
    if (activeSettingsPage === "skills") {
      return renderSkillsPage();
    }
    if (activeSettingsPage === "hooks") {
      return renderHooksPage();
    }
    if (activeSettingsPage === "personalization") {
      return renderPersonalizationPage();
    }
    return renderGeneralPage();
  }

  return (
    <div className="grid min-h-[calc(100vh-2rem)] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-h-0">
        <div className="flex h-full min-h-[20rem] flex-col rounded-[var(--app-radius-xl)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_96%,transparent)]">
          <div className="border-b border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] px-4 py-4">
            <button
              type="button"
              onClick={onReturnToApp}
              className="inline-flex items-center gap-2 rounded-[var(--app-radius-pill)] px-1 py-1 text-sm text-[var(--app-text-secondary)] transition hover:text-[var(--app-text-primary)]"
            >
              <ArrowLeftIcon />
              <span>返回应用</span>
            </button>
          </div>

          <div className="flex-1 px-4 py-4">
            <div className="grid gap-2">
              {settingsPages.map((item) => {
                const isActive = item.id === activeSettingsPage;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectSettingsPage(item.id)}
                    className={`rounded-[var(--app-radius-lg)] px-4 py-3 text-left transition ${
                      isActive
                        ? "bg-[color:color-mix(in_srgb,var(--app-bg-elevated)_90%,transparent)] text-[var(--app-text-primary)]"
                        : "text-[var(--app-text-secondary)] hover:bg-[color:color-mix(in_srgb,var(--app-bg-muted)_54%,transparent)] hover:text-[var(--app-text-primary)]"
                    }`}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                      {item.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] px-4 py-4">
            <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              Settings
            </div>
            <div className="mt-2 text-sm text-[var(--app-text-secondary)]">
              {settingsMeta}
            </div>
          </div>
        </div>
      </aside>

      <section className="min-h-0 rounded-[var(--app-radius-xl)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_96%,transparent)]">
        <header className="border-b border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] px-5 pb-4 pt-5">
          <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Settings
          </div>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-[var(--app-text-primary)]">
                {page?.title ?? "设置"}
              </h2>
              <p className="mt-2 max-w-[44rem] text-sm leading-6 text-[var(--app-text-muted)]">
                {page?.description ?? "管理默认设置。"}
              </p>
            </div>
            <div className="text-xs text-[var(--app-text-muted)]">
              {settingsMeta}
            </div>
          </div>
        </header>

        <div className="grid gap-5 px-5 pb-5 pt-4">{renderPageContent()}</div>

        <div className="px-5 pb-5">
          <div className="rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] px-4 py-3 text-xs text-[var(--app-text-muted)]">
            {statusText}
          </div>
        </div>
      </section>
    </div>
  );
}
