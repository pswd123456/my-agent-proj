"use client";

import type { ReactNode } from "react";

import { WorkbenchPanel } from "@ai-app-template/ui-patterns";
import type { RoutineRecord, SessionSnapshot } from "@ai-app-template/sdk";

import { formatDayLabel, getSoftBlockClass } from "./session-workbench-shared";
import type { InspectorProjection } from "./session-message-manager";
import { SessionWorkbenchInspector } from "./session-workbench-inspector";
import type { InspectorTabId, SidebarPanelId } from "./session-workbench-types";

interface SessionWorkbenchDrawerProps {
  activeSidebarPanel: SidebarPanelId | null;
  currentSession: SessionSnapshot | null;
  submitting: boolean;
  resettingRoutines: boolean;
  weekDates: string[];
  groupedRoutines: Map<string, RoutineRecord[]>;
  inspectorProjection: InspectorProjection;
  activeTab: InspectorTabId;
  onResetAllRoutines: () => void;
  onSelectTab: (tabId: InspectorTabId) => void;
  headerActions?: ReactNode;
}

function getDrawerEyebrow(panel: SidebarPanelId): string {
  return panel === "calendar" ? "Calendar" : "Inspector";
}

function getDrawerTitle(panel: SidebarPanelId): string {
  return panel === "calendar" ? "日程视图" : "调试详情";
}

export function SessionWorkbenchDrawer({
  activeSidebarPanel,
  currentSession,
  submitting,
  resettingRoutines,
  weekDates,
  groupedRoutines,
  inspectorProjection,
  activeTab,
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
