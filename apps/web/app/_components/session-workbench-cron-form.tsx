"use client";

import type { FormEvent } from "react";

import type { CronJobRecord, ModelCatalogEntry } from "@ai-app-template/sdk";

import {
  buildCreateCronJobPayload,
  buildUpdateCronJobPayload,
  cronIntervalUnitOptions,
  cronScheduleModeOptions,
  cronStatusOptions,
  cronWeekdayOptions,
  resolveModelThinkingEffortOptions,
  type CronJobFormState
} from "./session-workbench-types";

interface SessionWorkbenchCronFormProps {
  currentCronJob: CronJobRecord | null;
  formState: CronJobFormState;
  modelCatalog: ModelCatalogEntry[];
  defaultModelId: string;
  saving: boolean;
  choosingWorkingDirectory: boolean;
  statusText: string | null;
  errorText: string | null;
  onFormChange: (patch: Partial<CronJobFormState>) => void;
  onSubmit: (
    payload:
      | ReturnType<typeof buildCreateCronJobPayload>
      | ReturnType<typeof buildUpdateCronJobPayload>
  ) => void;
  onChooseWorkingDirectory: () => void;
  onJumpToSession: (sessionId: string) => void;
}

function getThinkingEffortOptions(input: {
  formState: CronJobFormState;
  defaultModelId: string;
  modelCatalog: ModelCatalogEntry[];
}): string[] {
  return resolveModelThinkingEffortOptions({
    modelCatalog: input.modelCatalog,
    modelId: input.formState.model || input.defaultModelId
  });
}

export function SessionWorkbenchCronForm({
  currentCronJob,
  formState,
  modelCatalog,
  defaultModelId,
  saving,
  choosingWorkingDirectory,
  statusText,
  errorText,
  onFormChange,
  onSubmit,
  onChooseWorkingDirectory,
  onJumpToSession
}: SessionWorkbenchCronFormProps) {
  const thinkingEffortOptions = getThinkingEffortOptions({
    formState,
    defaultModelId,
    modelCatalog
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(
      currentCronJob
        ? buildUpdateCronJobPayload(formState)
        : buildCreateCronJobPayload(formState)
    );
  }

  return (
    <div className="grid gap-4">
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

      <form onSubmit={handleSubmit} className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
            名称
          </span>
          <input
            value={formState.name}
            onChange={(event) => onFormChange({ name: event.target.value })}
            className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
            Prompt
          </span>
          <textarea
            value={formState.prompt}
            onChange={(event) => onFormChange({ prompt: event.target.value })}
            rows={6}
            className="min-h-[144px] rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm leading-6 text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
          />
        </label>

        <div className="grid gap-2">
          <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
            调度方式
          </span>
          <div className="flex flex-wrap gap-2">
            {cronScheduleModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  onFormChange({
                    scheduleMode: option.value as CronJobFormState["scheduleMode"]
                  })
                }
                className={`rounded-[var(--app-radius-pill)] border px-3 py-2 text-[0.72rem] uppercase tracking-[0.12em] transition ${
                  formState.scheduleMode === option.value
                    ? "border-[var(--app-border-accent)] text-[var(--app-text-primary)]"
                    : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {formState.scheduleMode === "interval" ? (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                间隔值
              </span>
              <input
                type="number"
                min={1}
                value={formState.intervalValue}
                onChange={(event) =>
                  onFormChange({ intervalValue: event.target.value })
                }
                className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                单位
              </span>
              <select
                value={formState.intervalUnit}
                onChange={(event) =>
                  onFormChange({
                    intervalUnit: event.target.value as CronJobFormState["intervalUnit"]
                  })
                }
                className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
              >
                {cronIntervalUnitOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                星期
              </span>
              <select
                value={formState.weekday}
                onChange={(event) =>
                  onFormChange({
                    weekday: event.target.value as CronJobFormState["weekday"]
                  })
                }
                className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
              >
                {cronWeekdayOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                时间
              </span>
              <input
                type="time"
                value={formState.timeOfDay}
                onChange={(event) =>
                  onFormChange({ timeOfDay: event.target.value })
                }
                className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
              />
            </label>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
              生效时间
            </span>
            <input
              type="datetime-local"
              value={formState.startsAt}
              onChange={(event) =>
                onFormChange({ startsAt: event.target.value })
              }
              className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
              状态
            </span>
            <select
              value={formState.status}
              onChange={(event) =>
                onFormChange({
                  status: event.target.value as CronJobFormState["status"]
                })
              }
              className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
            >
              {cronStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-2">
          <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
            次数
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onFormChange({ maxRunsMode: "infinite", maxRuns: "" })}
              className={`rounded-[var(--app-radius-pill)] border px-3 py-2 text-[0.72rem] uppercase tracking-[0.12em] transition ${
                formState.maxRunsMode === "infinite"
                  ? "border-[var(--app-border-accent)] text-[var(--app-text-primary)]"
                  : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
              }`}
            >
              无限
            </button>
            <button
              type="button"
              onClick={() =>
                onFormChange({
                  maxRunsMode: "finite",
                  maxRuns: formState.maxRuns || "1"
                })
              }
              className={`rounded-[var(--app-radius-pill)] border px-3 py-2 text-[0.72rem] uppercase tracking-[0.12em] transition ${
                formState.maxRunsMode === "finite"
                  ? "border-[var(--app-border-accent)] text-[var(--app-text-primary)]"
                  : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
              }`}
            >
              有限次数
            </button>
          </div>
          {formState.maxRunsMode === "finite" ? (
            <input
              type="number"
              min={1}
              value={formState.maxRuns}
              onChange={(event) => onFormChange({ maxRuns: event.target.value })}
              className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
            />
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
              工作目录
            </span>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={formState.workingDirectory}
                onChange={(event) =>
                  onFormChange({ workingDirectory: event.target.value })
                }
                className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
              />
              <button
                type="button"
                onClick={onChooseWorkingDirectory}
                disabled={choosingWorkingDirectory}
                className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-[0.72rem] uppercase tracking-[0.12em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] disabled:opacity-60"
              >
                {choosingWorkingDirectory ? "选择中..." : "选择目录"}
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                模型覆盖
              </span>
              <select
                value={formState.model}
                onChange={(event) => onFormChange({ model: event.target.value })}
                className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
              >
                <option value="">跟随用户设置</option>
                {modelCatalog.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                Thinking
              </span>
              <select
                value={formState.thinkingEffort}
                onChange={(event) =>
                  onFormChange({ thinkingEffort: event.target.value })
                }
                className="rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-3 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)]"
              >
                <option value="">跟随用户设置</option>
                {thinkingEffortOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] px-4 py-2 text-xs text-[var(--app-text-primary)] transition hover:bg-[color:color-mix(in_srgb,var(--app-text-accent)_12%,transparent)] disabled:opacity-60"
          >
            {saving ? "保存中..." : currentCronJob ? "保存修改" : "创建任务"}
          </button>
          {currentCronJob?.latestRunSessionId ? (
            <button
              type="button"
              onClick={() => onJumpToSession(currentCronJob.latestRunSessionId!)}
              className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-xs text-[var(--app-text-muted)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
            >
              打开最近一次运行
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
