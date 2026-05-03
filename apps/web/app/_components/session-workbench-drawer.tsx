"use client";

import type { ReactNode } from "react";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import type {
  CronJobRecord,
  CreateCronJobPayload,
  ModelCatalogEntry,
  SessionSnapshot,
  UpdateCronJobPayload
} from "@ai-app-template/sdk";

import { getSoftBlockClass } from "./session-workbench-shared";
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
  onSelectTab: (tabId: InspectorTabId) => void;
  headerActions?: ReactNode;
}

function getDrawerEyebrow(panel: SidebarPanelId): string {
  if (panel === "cron" || panel === "cron-create") {
    return "Cron";
  }
  return "Inspector";
}

function getDrawerTitle(panel: SidebarPanelId): string {
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
          activeSidebarPanel === "cron"
            ? `${cronJobs.length} jobs`
            : activeSidebarPanel === "cron-create"
              ? "form"
              : `${inspectorProjection.inspectorEvents.length} events`
        }
        headerActions={headerActions}
      >
        <div className="grid min-h-0 min-w-0 gap-5">
          {activeSidebarPanel === "cron" ? (
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
