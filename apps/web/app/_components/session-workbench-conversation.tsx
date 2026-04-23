"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import { MessageMarkdown } from "./message-markdown";
import {
  getNextTypewriterLength,
  splitTypewriterCharacters,
  TYPEWRITER_FRAME_MS
} from "./message-typewriter";
import { getTimelineEventKey, type TimelineItem } from "./session-timeline";
import type { TurnUsageSummary } from "./session-workbench-types";
import {
  formatCacheUsage,
  formatContextWindowUsage,
  formatTimestamp,
  formatTokenCount,
  formatWorkingDirectory,
  getBubbleClass,
  getDebugPreClass,
  getInspectorCardClass,
  getPermissionFamilyLabel,
  getSoftBlockClass,
  stringify
} from "./session-workbench-shared";

interface SessionWorkbenchConversationPanelProps {
  currentSession: SessionSnapshot | null;
  loading: boolean;
  loadingSession: boolean;
  timelineItems: TimelineItem[];
  streamEventKeys: Set<string>;
  turnUsageByTurnCount: Map<number, TurnUsageSummary>;
  pendingPermissionRequest: SessionSnapshot["context"]["pendingPermissionRequest"];
  message: string;
  submitting: boolean;
  errorText: string | null;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPermissionQuickReply: (reply: string) => void;
}

interface AssistantTextBubbleProps {
  content: string;
  itemKey: string;
  animate: boolean;
}

function splitShellTokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function buildPermissionQuickReplies(
  request: SessionSnapshot["context"]["pendingPermissionRequest"]
): Array<{ label: string; reply: string }> {
  if (!request) {
    return [];
  }

  if (request.toolName === "run_shell_command") {
    const command =
      typeof request.toolInput.command === "string"
        ? request.toolInput.command.trim()
        : "";
    const tokens = splitShellTokens(command);
    const replies: Array<{ label: string; reply: string }> = [];

    if (tokens.length > 0) {
      const firstPattern = tokens.length === 1 ? tokens[0] : `${tokens[0]} *`;
      replies.push({
        label: `本会话允许 shell:${firstPattern}`,
        reply: `本会话允许 shell:${firstPattern}`
      });
    }

    if (tokens.length > 1) {
      const secondPattern = `${tokens.slice(0, 2).join(" ")} *`;
      const reply = `本会话允许 shell:${secondPattern}`;
      if (!replies.some((item) => item.reply === reply)) {
        replies.push({ label: reply, reply });
      }
    }

    if (replies.length > 0) {
      return replies;
    }
  }

  return [
    {
      label: `本会话允许 tool:${request.toolName}`,
      reply: `本会话允许 tool:${request.toolName}`
    }
  ];
}

function renderUserMessageBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "user" }>
) {
  return (
    <div key={block.id} className={getBubbleClass("user")}>
      {block.content}
    </div>
  );
}

function AssistantTextBubble({
  content,
  itemKey,
  animate
}: AssistantTextBubbleProps) {
  const characters = useMemo(
    () => splitTypewriterCharacters(content),
    [content]
  );
  const totalLength = characters.length;
  const [visibleLength, setVisibleLength] = useState(() =>
    animate ? 0 : totalLength
  );

  useEffect(() => {
    if (!animate) {
      setVisibleLength(totalLength);
      return;
    }

    setVisibleLength(0);
  }, [animate, itemKey, totalLength]);

  useEffect(() => {
    if (!animate || visibleLength >= totalLength) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setVisibleLength((current) =>
        getNextTypewriterLength(current, totalLength)
      );
    }, TYPEWRITER_FRAME_MS);

    return () => window.clearTimeout(timeoutId);
  }, [animate, totalLength, visibleLength]);

  const isTyping = animate && visibleLength < totalLength;
  const visibleContent = isTyping
    ? characters.slice(0, visibleLength).join("")
    : content;

  return (
    <div className={getBubbleClass("assistant")}>
      {isTyping ? (
        <div className="min-w-0 whitespace-pre-wrap text-sm leading-7 text-inherit [overflow-wrap:anywhere]">
          {visibleContent}
          <span
            aria-hidden
            className="ml-1 inline-block h-[1em] w-[0.55ch] translate-y-[0.12em] animate-pulse rounded-[2px] bg-[var(--app-accent)] align-baseline"
          />
        </div>
      ) : (
        <MessageMarkdown content={visibleContent} />
      )}
    </div>
  );
}

function renderAssistantMessageBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "assistant" }>
) {
  return (
    <AssistantTextBubble
      key={block.id}
      itemKey={block.id}
      content={block.content}
      animate={false}
    />
  );
}

function renderToolCallBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "tool call" }>
) {
  return (
    <article key={block.id} className={getInspectorCardClass()}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Tool Call
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
            {block.toolName}
          </div>
        </div>
        <div className="text-[0.72rem] text-[var(--app-text-muted)]">
          {formatTimestamp(block.createdAt)}
        </div>
      </div>
      <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
        {stringify(block.input)}
      </pre>
    </article>
  );
}

function renderToolResultBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "tool result" }>
) {
  return (
    <article key={block.id} className={getInspectorCardClass()}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Tool Result
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
            {block.toolName}
          </div>
        </div>
        <div
          className={`text-[0.72rem] ${
            block.isError
              ? "text-[var(--app-status-danger)]"
              : "text-[var(--app-status-success)]"
          }`}
        >
          {block.isError ? "failed" : "ok"}
        </div>
      </div>
      <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
        {block.output}
      </pre>
    </article>
  );
}

function renderConversationBlock(block: SessionSnapshot["messages"][number]) {
  if (block.kind === "user") {
    return renderUserMessageBlock(block);
  }

  if (block.kind === "assistant") {
    return renderAssistantMessageBlock(block);
  }

  if (block.kind === "tool call") {
    return renderToolCallBlock(block);
  }

  return renderToolResultBlock(block);
}

function renderPendingUserMessage(text: string, createdAt: string) {
  return (
    <div key={`pending-user-${createdAt}`} className={getBubbleClass("user")}>
      {text}
    </div>
  );
}

function renderExecutionEvent(
  event: RunStreamEvent,
  streamEventKeys: Set<string>,
  turnUsageByTurnCount: Map<number, TurnUsageSummary>
) {
  if (event.kind === "assistant_text") {
    const eventKey = getTimelineEventKey(event);

    return (
      <AssistantTextBubble
        key={eventKey}
        itemKey={eventKey}
        content={event.text}
        animate={streamEventKeys.has(eventKey)}
      />
    );
  }

  if (event.kind === "thinking") {
    return (
      <article
        key={getTimelineEventKey(event)}
        className={getInspectorCardClass(
          "text-sm leading-7 text-[var(--app-text-muted)]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Thinking
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {event.text}
        </div>
      </article>
    );
  }

  if (event.kind === "tool_call") {
    return (
      <article
        key={getTimelineEventKey(event)}
        className={getInspectorCardClass()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              Tool Call
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              {event.toolName}
            </div>
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
          {stringify(event.input)}
        </pre>
      </article>
    );
  }

  if (
    event.kind === "permission_request" ||
    event.kind === "permission_approved" ||
    event.kind === "permission_rejected"
  ) {
    const toneClass =
      event.kind === "permission_approved"
        ? "text-[var(--app-status-success)]"
        : event.kind === "permission_rejected"
          ? "text-[var(--app-status-danger)]"
          : "text-[var(--app-status-warning)]";

    return (
      <article
        key={getTimelineEventKey(event)}
        className={getInspectorCardClass()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              Permission
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              {event.toolName}
            </div>
          </div>
          <div className={`text-[0.72rem] ${toneClass}`}>
            {event.kind.replace("permission_", "")}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--app-text-secondary)]">
          <div>{event.request.summaryText}</div>
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
            {getPermissionFamilyLabel(event.request.family)} /{" "}
            {event.request.permissionProfile}
          </div>
          {event.request.contextNote ? (
            <div className="text-[var(--app-text-muted)]">
              {event.request.contextNote}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  if (event.kind === "permission_blocked") {
    return (
      <article
        key={getTimelineEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,var(--app-bg-muted)_88%)] px-4 py-4 text-sm leading-7 text-[var(--app-status-danger)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em]">
            Permission Blocked
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3 text-[var(--app-text-primary)]">
          {event.toolName}
        </div>
        <div className="mt-2">{event.reason}</div>
      </article>
    );
  }

  if (event.kind === "tool_result") {
    return (
      <article
        key={getTimelineEventKey(event)}
        className={getInspectorCardClass()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              Tool Result
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              {event.toolName}
            </div>
          </div>
          <div
            className={`text-[0.72rem] ${
              event.isError
                ? "text-[var(--app-status-danger)]"
                : "text-[var(--app-status-success)]"
            }`}
          >
            {event.isError ? "failed" : "ok"}
          </div>
        </div>
        <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
          {event.displayText ?? event.output}
        </pre>
      </article>
    );
  }

  if (event.kind === "turn_start" || event.kind === "turn_end") {
    const turnUsage =
      event.kind === "turn_end"
        ? (turnUsageByTurnCount.get(event.turnCount) ?? null)
        : null;

    return (
      <div
        key={getTimelineEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-text-primary)]">
          {event.kind === "turn_start"
            ? `Turn ${event.turnCount} started`
            : `Turn ${event.turnCount} ended`}
          {turnUsage
            ? ` / input ${formatTokenCount(turnUsage.inputTokens)} / ${formatCacheUsage(turnUsage)}`
            : ""}
        </span>
        <span className="font-mono text-[var(--app-text-muted)]">
          {formatTimestamp(event.createdAt)}
        </span>
      </div>
    );
  }

  if (event.kind === "fallback") {
    return (
      <article
        key={getTimelineEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-muted)_88%)] px-4 py-4 text-sm leading-7 text-[var(--app-text-secondary)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Fallback
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3">{event.summary}</div>
      </article>
    );
  }

  if (event.kind === "run_error") {
    return (
      <article
        key={getTimelineEventKey(event)}
        className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,var(--app-bg-muted)_88%)] px-4 py-4 text-sm leading-7 text-[var(--app-status-danger)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em]">
            Run Error
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3">{event.error}</div>
      </article>
    );
  }

  if (event.kind === "response") {
    return (
      <div
        key={getTimelineEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-text-primary)]">
          response / input {event.usage.inputTokens} / output{" "}
          {event.usage.outputTokens} / {formatCacheUsage(event.usage)}
        </span>
        <span className="font-mono text-[var(--app-text-muted)]">
          {formatTimestamp(event.createdAt)}
        </span>
      </div>
    );
  }

  if (event.kind === "run_complete") {
    return (
      <div
        key={getTimelineEventKey(event)}
        className="flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-status-success)_12%,var(--app-bg-muted)_88%)] px-3 py-2 text-xs text-[var(--app-text-secondary)]"
      >
        <span className="font-medium text-[var(--app-status-success)]">
          run complete / {event.status}
        </span>
        <span className="font-mono text-[var(--app-text-muted)]">
          {formatTimestamp(event.createdAt)}
        </span>
      </div>
    );
  }

  return null;
}

function renderTimelineItem(
  item: TimelineItem,
  streamEventKeys: Set<string>,
  turnUsageByTurnCount: Map<number, TurnUsageSummary>
) {
  if (item.type === "event") {
    return renderExecutionEvent(
      item.event,
      streamEventKeys,
      turnUsageByTurnCount
    );
  }

  if (item.type === "pending-user") {
    return renderPendingUserMessage(item.text, item.createdAt);
  }

  return renderConversationBlock(item.block);
}

export function SessionWorkbenchConversationPanel({
  currentSession,
  loading,
  loadingSession,
  timelineItems,
  streamEventKeys,
  turnUsageByTurnCount,
  pendingPermissionRequest,
  message,
  submitting,
  errorText,
  onMessageChange,
  onSubmit,
  onPermissionQuickReply
}: SessionWorkbenchConversationPanelProps) {
  const [copyButtonLabel, setCopyButtonLabel] = useState("复制");

  useEffect(() => {
    if (copyButtonLabel === "复制") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyButtonLabel("复制");
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [copyButtonLabel]);

  async function handleCopySessionId() {
    const sessionId = currentSession?.sessionId;
    if (!sessionId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(sessionId);
      setCopyButtonLabel("已复制");
    } catch {
      setCopyButtonLabel("复制失败");
    }
  }

  return (
    <section className="rounded-[var(--app-radius-xl)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_92%,var(--app-bg-elevated)_8%)] shadow-[var(--app-shadow-sm)]">
      <div className="px-4 py-4">
        <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 lg:min-h-[calc(100vh-6rem)]">
          <div className={getSoftBlockClass("flex flex-col gap-2")}>
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                Active Session
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-0 font-mono text-[var(--app-text-primary)]">
                  {currentSession?.sessionId ?? "loading"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopySessionId()}
                  disabled={!currentSession?.sessionId}
                  className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copyButtonLabel}
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-80 pr-1">
            <div className="grid gap-4">
              {loading && !currentSession ? (
                <div
                  className={getSoftBlockClass(
                    "py-10 text-sm text-[var(--app-text-muted)]"
                  )}
                >
                  正在初始化工作台...
                </div>
              ) : null}

              {timelineItems.length ? (
                timelineItems.map((item) =>
                  renderTimelineItem(
                    item,
                    streamEventKeys,
                    turnUsageByTurnCount
                  )
                )
              ) : (
                <div
                  className={getSoftBlockClass(
                    "py-6 text-sm text-[var(--app-text-muted)]"
                  )}
                >
                  发送请求后，这里会显示当前会话的对话和执行记录。
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-3 z-10 mt-auto px-1">
            <form onSubmit={onSubmit} className="grid gap-3">
              <div className="grid gap-3 rounded-[var(--app-radius-xl)] bg-[var(--app-bg-canvas)] p-1">
                {pendingPermissionRequest ? (
                  <div className="rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-status-warning)_56%,var(--app-border-subtle)_44%)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_14%,var(--app-bg-surface)_86%)] px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                          Permission Request
                        </div>
                        <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
                          {pendingPermissionRequest.toolName}
                        </div>
                        <div className="mt-2 text-sm leading-7 text-[var(--app-text-secondary)]">
                          {pendingPermissionRequest.summaryText}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {buildPermissionQuickReplies(
                          pendingPermissionRequest
                        ).map((option) => (
                          <button
                            key={option.reply}
                            type="button"
                            onClick={() => onPermissionQuickReply(option.reply)}
                            disabled={submitting}
                            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {option.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => onPermissionQuickReply("取消")}
                          disabled={submitting}
                          className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-4 py-2 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <textarea
                  value={message}
                  onChange={(event) => onMessageChange(event.target.value)}
                  rows={3}
                  placeholder="输入你的请求"
                  className="w-full resize-none rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm leading-7 text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[0.72rem]">
                    {submitting ? (
                      <span className="text-xs text-[var(--app-text-muted)]">
                        正在接收当前响应...
                      </span>
                    ) : null}
                    <span className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[var(--app-text-secondary)]">
                      status {currentSession?.context.status ?? "--"}
                    </span>
                    <span className="min-w-0 rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 font-mono text-[var(--app-text-secondary)]">
                      cwd{" "}
                      {formatWorkingDirectory(
                        currentSession?.workingDirectory ?? "--"
                      )}
                    </span>
                    <span
                      className={`rounded-[var(--app-radius-pill)] border px-3 py-1 ${
                        currentSession?.context.yoloMode
                          ? "border-[var(--app-status-success)] text-[var(--app-status-success)]"
                          : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)]"
                      }`}
                    >
                      yolo {currentSession?.context.yoloMode ? "on" : "off"}
                    </span>
                    <span className="font-mono text-xs text-[var(--app-text-muted)]">
                      {currentSession
                        ? formatContextWindowUsage(
                            currentSession.inputTokensCount,
                            currentSession.contextWindow
                          )
                        : "total input -- / ctx --"}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center justify-end">
                    <button
                      type="submit"
                      disabled={
                        !currentSession || !message.trim() || submitting
                      }
                      className="inline-flex items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-5 py-2 text-sm font-medium text-[var(--app-text-primary)] transition disabled:cursor-not-allowed disabled:opacity-50 hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)]"
                    >
                      {submitting ? "Running..." : "发送"}
                    </button>
                  </div>
                </div>

                {errorText ? (
                  <div className="rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,var(--app-bg-muted)_88%)] px-4 py-3 text-sm text-[var(--app-status-danger)]">
                    {errorText}
                  </div>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
