"use client";

import type { CronJobRecord } from "@ai-app-template/sdk";

import { formatTimestamp, formatWorkingDirectory } from "./session-workbench-shared";

interface SessionWorkbenchCronPanelProps {
  cronJobs: CronJobRecord[];
  loading: boolean;
  deletingCronJobId: string | null;
  statusText: string | null;
  errorText: string | null;
  onCreateNew: () => void;
  onSelectCronJob: (cronJob: CronJobRecord) => void;
  onToggleStatus: (cronJob: CronJobRecord) => void;
  onDeleteCronJob: (cronJobId: string) => void;
  onJumpToSession: (sessionId: string) => void;
}

function getStatusToneClass(status: CronJobRecord["status"]): string {
  switch (status) {
    case "active":
      return "border-[var(--app-border-accent)] text-[var(--app-text-primary)]";
    case "paused":
      return "border-[var(--app-status-warning)] text-[var(--app-status-warning)]";
    case "completed":
      return "border-[var(--app-border-subtle)] text-[var(--app-text-muted)]";
  }
}

function getLatestRunToneClass(status: string | null): string {
  if (status === "completed") {
    return "text-[var(--app-text-primary)]";
  }
  if (status === "failed" || status === "cancelled") {
    return "text-[var(--app-status-danger)]";
  }
  if (status === "running" || status === "claimed") {
    return "text-[var(--app-text-accent)]";
  }
  return "text-[var(--app-text-muted)]";
}

export function SessionWorkbenchCronPanel({
  cronJobs,
  loading,
  deletingCronJobId,
  statusText,
  errorText,
  onCreateNew,
  onSelectCronJob,
  onToggleStatus,
  onDeleteCronJob,
  onJumpToSession
}: SessionWorkbenchCronPanelProps) {
  return (
    <section className="grid min-h-0 gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--app-text-primary)]">定义列表</div>
          <div className="mt-1 text-xs text-[var(--app-text-muted)]">
            每次触发都会创建一个新会话。
          </div>
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] px-4 py-2 text-xs text-[var(--app-text-primary)] transition hover:bg-[color:color-mix(in_srgb,var(--app-text-accent)_12%,transparent)]"
        >
          新建任务
        </button>
      </div>

      {statusText ? (
        <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] px-4 py-3 text-sm text-[var(--app-text-secondary)]">
          {statusText}
        </div>
      ) : null}
      {errorText ? (
        <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-status-danger)] px-4 py-3 text-sm text-[var(--app-status-danger)]">
          {errorText}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] px-4 py-4 text-sm text-[var(--app-text-muted)]">
          正在加载定时任务...
        </div>
      ) : cronJobs.length === 0 ? (
        <div className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] px-4 py-4 text-sm text-[var(--app-text-muted)]">
          还没有定时任务。
        </div>
      ) : (
        <div className="grid gap-3">
          {cronJobs.map((cronJob) => (
            <div
              key={cronJob.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectCronJob(cronJob)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                onSelectCronJob(cronJob);
              }}
              className="grid gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_68%,transparent)] px-4 py-4 text-left transition hover:border-[var(--app-border-strong)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--app-text-primary)]">
                    {cronJob.name}
                  </div>
                  <div className="mt-1 text-xs text-[var(--app-text-muted)]">
                    {formatWorkingDirectory(cronJob.workingDirectory)}
                  </div>
                </div>
                <span
                  className={`rounded-[var(--app-radius-pill)] border px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.14em] ${getStatusToneClass(cronJob.status)}`}
                >
                  {cronJob.status}
                </span>
              </div>

              <div className="grid gap-1 text-xs text-[var(--app-text-secondary)]">
                <div>
                  下次运行:{" "}
                  {cronJob.nextRunAt ? formatTimestamp(cronJob.nextRunAt) : "--"}
                </div>
                <div>
                  剩余次数:{" "}
                  {cronJob.remainingRuns === null ? "无限" : cronJob.remainingRuns}
                </div>
                <div className={getLatestRunToneClass(cronJob.latestRunStatus)}>
                  最新运行: {cronJob.latestRunStatus ?? "--"}
                </div>
                {cronJob.lastError ? (
                  <div className="line-clamp-2 text-[var(--app-status-danger)]">
                    {cronJob.lastError}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleStatus(cronJob);
                  }}
                  className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.12em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                >
                  {cronJob.status === "active" ? "暂停" : "启用"}
                </button>
                {cronJob.latestRunSessionId ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onJumpToSession(cronJob.latestRunSessionId!);
                    }}
                    className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.12em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                  >
                    最近一次运行
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteCronJob(cronJob.id);
                  }}
                  disabled={deletingCronJobId === cronJob.id}
                  className="rounded-[var(--app-radius-pill)] border border-[var(--app-status-danger)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.12em] text-[var(--app-status-danger)] transition hover:bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)] disabled:opacity-60"
                >
                  {deletingCronJobId === cronJob.id ? "删除中..." : "删除"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
