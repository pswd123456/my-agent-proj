"use client";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import type {
  RoutineRecord,
  RunStreamEvent,
  SessionSnapshot
} from "@ai-app-template/sdk";

import {
  capabilityPackOptions,
  MAX_TURNS_LIMIT,
  permissionToolOptions,
  type InspectorTabId,
  type SettingsFormState,
  type SidebarPanelId
} from "./session-workbench-types";
import {
  formatDayLabel,
  formatWorkingDirectory,
  getPermissionToolLabel,
  getSoftBlockClass
} from "./session-workbench-shared";
import { SessionWorkbenchInspector } from "./session-workbench-inspector";
import type { ToolRow } from "./session-workbench-state";

const sectionHeadingClassName =
  "text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]";
const tertiaryHeadingClassName =
  "text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]";

function formatToolOptionLabel(toolName: string): string {
  return toolName.replaceAll("_", " ");
}

function formatCapabilityPackLabel(packName: string): string {
  return packName === "workspace" ? "Workspace" : "Schedule";
}

function formatCapabilityPackDescription(packName: string): string {
  return packName === "workspace"
    ? "文件、搜索、shell 与网络等工作区能力。"
    : "日程创建、编辑、查询与冲突确认相关能力。";
}

function getVisiblePermissionTools(enabledCapabilityPacks: string[]): string[] {
  const enabled = new Set(enabledCapabilityPacks);

  return permissionToolOptions.filter((tool) => {
    if (
      [
        "create_routine",
        "edit_routine",
        "delete_routine",
        "search_routine_by_oclock",
        "list_routine_by_week",
        "list_routine_by_date",
        "ask_for_confirmation"
      ].includes(tool)
    ) {
      return enabled.has("schedule");
    }

    return enabled.has("workspace");
  });
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
  promptEvents: PromptEvent[];
  onResetAllRoutines: () => void;
  onSelectTab: (tabId: InspectorTabId) => void;
  onSettingsFormChange: (patch: Partial<SettingsFormState>) => void;
  onSettingsBlur: () => void;
  onSettingsYoloModeChange: (checked: boolean) => void;
  onSettingsPermissionToolToggle: (
    toolName: string,
    target: "allow" | "ask" | "deny"
  ) => void;
  onSettingsCapabilityPackToggle: (packName: string) => void;
}

type PromptEvent = Extract<RunStreamEvent, { kind: "prompt" }>;
type ThinkingEvent = Extract<RunStreamEvent, { kind: "thinking" }>;

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
  promptEvents,
  onResetAllRoutines,
  onSelectTab,
  onSettingsFormChange,
  onSettingsBlur,
  onSettingsYoloModeChange,
  onSettingsPermissionToolToggle,
  onSettingsCapabilityPackToggle
}: SessionWorkbenchDrawerProps) {
  if (!activeSidebarPanel) {
    return null;
  }

  const visiblePermissionTools = getVisiblePermissionTools(
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
                    className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                </label>
                <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                  <span className={tertiaryHeadingClassName}>Deny Patterns</span>
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
                    <div className="text-sm text-[var(--app-text-primary)]">YOLO</div>
                    <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                      打开后，工作区文件操作可直接执行；shell / network 仍按权限规则处理。
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsForm.yoloMode}
                    onChange={(event) =>
                      onSettingsYoloModeChange(event.target.checked)
                    }
                    className="h-4 w-4 accent-[var(--app-border-accent)]"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                    <span className={tertiaryHeadingClassName}>Context Window</span>
                    <input
                      value={settingsForm.contextWindow}
                      onChange={(event) =>
                        onSettingsFormChange({ contextWindow: event.target.value })
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
                    const checked = settingsForm.enabledCapabilityPacks.includes(pack);
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
                  <div className={tertiaryHeadingClassName}>Tool Permission</div>
                  {visiblePermissionTools.map((tool) => {
                    const decision = settingsForm.toolDenyList.includes(tool)
                      ? "deny"
                      : settingsForm.toolAllowList.includes(tool)
                        ? "allow"
                        : "ask";
                    return (
                      <div
                        key={tool}
                        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3"
                      >
                        <div>
                          <div className="text-sm text-[var(--app-text-primary)]">
                            {formatToolOptionLabel(tool)}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                            {tool}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(["allow", "ask", "deny"] as const).map((target) => (
                            <button
                              key={target}
                              type="button"
                              onClick={() =>
                                onSettingsPermissionToolToggle(tool, target)
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
              inspectorEvents={inspectorEvents}
              latestPromptEvent={latestPromptEvent}
              thinkingEvents={thinkingEvents}
              toolRows={toolRows}
              promptEvents={promptEvents}
              onSelectTab={onSelectTab}
            />
          ) : null}
        </div>
      </WorkbenchPanel>
    </div>
  );
}
