"use client";

import type { ReactNode } from "react";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import type {
  CronJobRecord,
  CreateCronJobPayload,
  ModelCatalogEntry,
  RoutineRecord,
  SessionSnapshot,
  UpdateCronJobPayload
} from "@ai-app-template/sdk";

import { formatDayLabel, getSoftBlockClass } from "./session-workbench-shared";
import type { InspectorProjection } from "./session-message-manager";
import { SessionWorkbenchCronForm } from "./session-workbench-cron-form";
import { SessionWorkbenchCronPanel } from "./session-workbench-cron-panel";
import { SessionWorkbenchInspector } from "./session-workbench-inspector";
import type {
  CronJobFormState,
  InspectorTabId,
  SidebarPanelId
} from "./session-workbench-types";

interface SessionWorkbenchDrawerProps {
  activeSidebarPanel: SidebarPanelId | null;
  currentSession: SessionSnapshot | null;
  cronJobs: CronJobRecord[];
  currentCronJob: CronJobRecord | null;
  cronFormState: CronJobFormState;
  cronLoading: boolean;
  cronSaving: boolean;
  cronDeletingJobId: string | null;
  cronStatusText: string | null;
  cronErrorText: string | null;
  choosingWorkingDirectory: boolean;
  modelCatalog: ModelCatalogEntry[];
  defaultModelId: string;
  submitting: boolean;
  resettingRoutines: boolean;
  weekDates: string[];
  groupedRoutines: Map<string, RoutineRecord[]>;
  inspectorProjection: InspectorProjection;
  activeTab: InspectorTabId;
  onCreateCronJob: () => void;
  onSelectCronJob: (cronJob: CronJobRecord) => void;
  onCronFormChange: (patch: Partial<CronJobFormState>) => void;
  onSaveCronJob: (payload: CreateCronJobPayload | UpdateCronJobPayload) => void;
  onToggleCronJobStatus: (cronJob: CronJobRecord) => void;
  onDeleteCronJob: (cronJobId: string) => void;
  onJumpToCronRun: (sessionId: string) => void;
  onChooseWorkingDirectory: () => void;
  onResetAllRoutines: () => void;
  onSelectTab: (tabId: InspectorTabId) => void;
  headerActions?: ReactNode;
}

function getDrawerEyebrow(panel: SidebarPanelId): string {
  if (panel === "calendar") {
    return "Calendar";
  }
  if (panel === "cron" || panel === "cron-create") {
    return "Cron";
  }
  return "Inspector";
}

function getDrawerTitle(panel: SidebarPanelId): string {
  if (panel === "calendar") {
    return "日程视图";
  }
  if (panel === "cron") {
    return "定时任务";
  }
  if (panel === "cron-create") {
    return "新建定时任务";
  }
  return "调试详情";
}

export function SessionWorkbenchDrawer({
  activeSidebarPanel,
  currentSession,
  cronJobs,
  currentCronJob,
  cronFormState,
  cronLoading,
  cronSaving,
  cronDeletingJobId,
  cronStatusText,
  cronErrorText,
  choosingWorkingDirectory,
  modelCatalog,
  defaultModelId,
  submitting,
  resettingRoutines,
  weekDates,
  groupedRoutines,
  inspectorProjection,
  activeTab,
  onCreateCronJob,
  onSelectCronJob,
  onCronFormChange,
  onSaveCronJob,
  onToggleCronJobStatus,
  onDeleteCronJob,
  onJumpToCronRun,
  onChooseWorkingDirectory,
  onResetAllRoutines,
  onSelectTab,
  headerActions
}: SessionWorkbenchDrawerProps) {
  if (!activeSidebarPanel || activeSidebarPanel === "settings") {
    return null;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <WorkbenchPanel
        eyebrow={getDrawerEyebrow(activeSidebarPanel)}
        title={getDrawerTitle(activeSidebarPanel)}
        meta={
          activeSidebarPanel === "calendar"
            ? (currentSession?.context.currentDateContext ?? "--")
            : activeSidebarPanel === "cron"
              ? `${cronJobs.length} jobs`
              : activeSidebarPanel === "cron-create"
                ? "form"
            : `${inspectorProjection.inspectorEvents.length} events`
        }
        headerActions={headerActions}
      >
        <div className="grid min-h-0 min-w-0 gap-5">
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

              {weekDates.length === 0 ? (
                <div
                  className={getSoftBlockClass(
                    "text-sm leading-6 text-[var(--app-text-muted)]"
                  )}
                >
                  当前会话还没有可展示的工作周。
                </div>
              ) : (
                weekDates.map((date) => (
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
                ))
              )}
            </div>
          ) : activeSidebarPanel === "cron" ? (
            <SessionWorkbenchCronPanel
              cronJobs={cronJobs}
              loading={cronLoading}
              deletingCronJobId={cronDeletingJobId}
              statusText={cronStatusText}
              errorText={cronErrorText}
              onCreateNew={onCreateCronJob}
              onSelectCronJob={onSelectCronJob}
              onToggleStatus={onToggleCronJobStatus}
              onDeleteCronJob={onDeleteCronJob}
              onJumpToSession={onJumpToCronRun}
            />
          ) : activeSidebarPanel === "cron-create" ? (
            <div className="grid gap-3">
              <div className="text-xs leading-5 text-[var(--app-text-muted)]">
                保存后会按计划自动创建新会话，运行记录仍会出现在左侧会话列表里。
              </div>
              <SessionWorkbenchCronForm
                currentCronJob={currentCronJob}
                formState={cronFormState}
                modelCatalog={modelCatalog}
                defaultModelId={defaultModelId}
                saving={cronSaving}
                choosingWorkingDirectory={choosingWorkingDirectory}
                statusText={cronStatusText}
                errorText={cronErrorText}
                onFormChange={onCronFormChange}
                onSubmit={onSaveCronJob}
                onChooseWorkingDirectory={onChooseWorkingDirectory}
                onJumpToSession={onJumpToCronRun}
              />
            </div>
          ) : (
            <SessionWorkbenchInspector
              activeTab={activeTab}
              inspectorProjection={inspectorProjection}
              onSelectTab={onSelectTab}
            />
          )}
        </div>
      </WorkbenchPanel>
    </div>
  );
}
