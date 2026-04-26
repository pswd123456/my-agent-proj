"use client";

import { useEffect, useRef, useState } from "react";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import { formatTimestamp } from "./session-workbench-shared";

type SessionTodoState = SessionSnapshot["context"]["todoState"];
type TodoItemStatus = NonNullable<SessionTodoState>["items"][number]["status"];

interface SessionTodoPanelProps {
  todoState: SessionTodoState | null | undefined;
  updating?: boolean;
}

interface TodoProgressStats {
  total: number;
  pending: number;
  inProgress: number;
  done: number;
  cancelled: number;
  completionPercent: number;
}

export function getTodoProgressStats(
  todoState: SessionTodoState | null | undefined
): TodoProgressStats {
  const items = todoState?.items ?? [];
  const stats = {
    total: items.length,
    pending: 0,
    inProgress: 0,
    done: 0,
    cancelled: 0,
    completionPercent: 0
  };

  for (const item of items) {
    if (item.status === "pending") {
      stats.pending += 1;
    } else if (item.status === "in_progress") {
      stats.inProgress += 1;
    } else if (item.status === "done") {
      stats.done += 1;
    } else if (item.status === "cancelled") {
      stats.cancelled += 1;
    }
  }

  if (stats.total > 0) {
    stats.completionPercent = Math.round((stats.done / stats.total) * 100);
  }

  return stats;
}

export function getTodoStatusLabel(status: TodoItemStatus): string {
  switch (status) {
    case "pending":
      return "待办";
    case "in_progress":
      return "进行中";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
  }
}

function getTodoStatusClass(status: TodoItemStatus): string {
  switch (status) {
    case "pending":
      return "text-[var(--app-text-muted)]";
    case "in_progress":
      return "text-[color:color-mix(in_srgb,var(--app-border-accent)_82%,white_18%)]";
    case "done":
      return "text-[var(--app-status-success)]";
    case "cancelled":
      return "text-[var(--app-status-danger)]";
  }
}

function getCollapsedSummaryText(input: {
  activeItem: NonNullable<SessionTodoState>["items"][number] | null;
  stats: TodoProgressStats;
}): string {
  const { activeItem, stats } = input;

  if (activeItem) {
    return activeItem.content;
  }

  if (stats.pending > 0) {
    return `还有 ${stats.pending} 项待处理`;
  }

  if (stats.done === stats.total) {
    return "当前清单已完成";
  }

  return "查看当前任务清单";
}

export function SessionTodoPanel({
  todoState,
  updating = false
}: SessionTodoPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const hadTodoRef = useRef(false);
  const hasTodo = Boolean(todoState && todoState.items.length > 0);

  useEffect(() => {
    if (hasTodo && !hadTodoRef.current) {
      setExpanded(true);
    }

    hadTodoRef.current = hasTodo;
  }, [hasTodo]);

  if (!hasTodo || !todoState) {
    return null;
  }

  const stats = getTodoProgressStats(todoState);
  const activeItem =
    todoState.activeItemId === null
      ? null
      : (todoState.items.find((item) => item.id === todoState.activeItemId) ??
        null);
  const lastUpdatedLabel = todoState.lastUpdatedAt
    ? formatTimestamp(todoState.lastUpdatedAt)
    : null;
  const collapsedSummaryText = getCollapsedSummaryText({ activeItem, stats });

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="展开 todo"
        title={collapsedSummaryText}
        className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--app-border-subtle)_62%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-elevated)_88%,var(--app-bg-surface)_12%)] font-mono text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)]"
      >
        ^
      </button>
    );
  }

  return (
    <section className="pointer-events-auto w-[min(34rem,100%)] rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_62%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-elevated)_88%,var(--app-bg-surface)_12%)] px-3 py-2.5 shadow-[0_10px_28px_rgba(0,0,0,0.18)]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
              Todo
            </span>
            <span className="text-[0.7rem] text-[var(--app-text-secondary)]">
              {stats.done}/{stats.total}
            </span>
            {activeItem ? (
              <span className="text-[0.7rem] text-[color:color-mix(in_srgb,var(--app-border-accent)_82%,white_18%)]">
                进行中
              </span>
            ) : null}
            {updating ? (
              <span className="text-[0.7rem] text-[color:color-mix(in_srgb,var(--app-border-accent)_82%,white_18%)]">
                更新中
              </span>
            ) : null}
          </div>

          <div
            className="mt-1 truncate text-sm leading-5 text-[var(--app-text-primary)]"
            title={collapsedSummaryText}
          >
            {collapsedSummaryText}
          </div>

          {expanded ? (
            <div className="mt-2 overflow-hidden rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_42%,transparent)]">
              {todoState.items.map((item, index) => {
                const isActive = item.id === todoState.activeItemId;
                const isMuted =
                  item.status === "done" || item.status === "cancelled";
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 ${
                      index > 0
                        ? "border-t border-[color:color-mix(in_srgb,var(--app-border-subtle)_42%,transparent)]"
                        : ""
                    } ${
                      isActive
                        ? "bg-[color:color-mix(in_srgb,var(--app-border-accent)_8%,transparent)]"
                        : ""
                    }`}
                  >
                    <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div
                      className={`min-w-0 flex-1 truncate text-sm ${
                        isMuted
                          ? "text-[var(--app-text-muted)]"
                          : "text-[var(--app-text-primary)]"
                      }`}
                      title={item.content}
                    >
                      {item.content}
                    </div>
                    {isActive ? (
                      <span className="text-[0.65rem] uppercase tracking-[0.14em] text-[color:color-mix(in_srgb,var(--app-border-accent)_82%,white_18%)]">
                        active
                      </span>
                    ) : null}
                    <span
                      className={`shrink-0 text-[0.65rem] uppercase tracking-[0.14em] ${getTodoStatusClass(
                        item.status
                      )}`}
                    >
                      {getTodoStatusLabel(item.status)}
                    </span>
                  </div>
                );
              })}

              {lastUpdatedLabel ? (
                <div className="border-t border-[color:color-mix(in_srgb,var(--app-border-subtle)_42%,transparent)] px-2.5 py-1.5 text-[0.72rem] text-[var(--app-text-muted)]">
                  最近更新 {lastUpdatedLabel}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="收起 todo"
          className="shrink-0 rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.14em] text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)]"
        >
          收起
        </button>
      </div>
    </section>
  );
}
