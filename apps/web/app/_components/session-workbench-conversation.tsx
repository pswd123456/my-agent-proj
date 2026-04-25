"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import { MessageMarkdown } from "./message-markdown";
import {
  getAssistantTextRenderMode,
  getNextTypewriterLength,
  getTypewriterVisibleLengthOnChange,
  splitTypewriterCharacters,
  TYPEWRITER_FRAME_MS
} from "./message-typewriter";
import {
  buildConversationScrollSnapshot,
  getConversationScrollIntent,
  getConversationResizeAutoFollowIntent,
  updateConversationAutoFollowState
} from "./session-workbench-scroll";
import { getTimelineEventKey, type TimelineItem } from "./session-timeline";
import type { TurnUsageSummary } from "./session-workbench-types";
import {
  formatCacheUsage,
  formatContextWindowUsage,
  formatTimestamp,
  formatTokenCount,
  formatWorkingDirectory,
  getBubbleClass,
  getDisplayStateToneClass,
  getDebugPreClass,
  getInspectorCardClass,
  getPermissionFamilyLabel,
  getSoftBlockClass,
  stringify
} from "./session-workbench-shared";
import { getSessionDisplayState } from "./session-workbench-state";

interface SessionWorkbenchConversationPanelProps {
  currentSession: SessionSnapshot | null;
  loading: boolean;
  timelineItems: TimelineItem[];
  streamEventKeys: Set<string>;
  recentAssistantEventKeys: Set<string>;
  turnUsageByTurnCount: Map<number, TurnUsageSummary>;
  pendingPermissionRequest: SessionSnapshot["context"]["pendingPermissionRequest"];
  message: string;
  submitting: boolean;
  canInterrupt: boolean;
  interrupting: boolean;
  showInterruptedHint: boolean;
  errorText: string | null;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInterrupt: () => void;
  onPermissionQuickReply: (reply: string) => void;
  onAssistantAnimationComplete: (itemKey: string) => void;
}

interface AssistantTextBubbleProps {
  content: string;
  itemKey: string;
  animate: boolean;
  streaming?: boolean;
  onAnimationComplete?: (itemKey: string) => void;
}

function AssistantRobotIcon() {
  return (
    <span
      aria-hidden
      className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] text-[var(--app-text-secondary)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4v3" />
        <path d="M9 4h6" />
        <rect x="5" y="8" width="14" height="10" rx="3" />
        <path d="M8 18v2" />
        <path d="M16 18v2" />
        <circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
        <path d="M9 15.8h6" />
      </svg>
    </span>
  );
}

type PermissionCardTone = "pending" | "approved" | "rejected";

interface PermissionCardFeedback {
  requestKey: string;
  toolName: string;
  summaryText: string;
  tone: Exclude<PermissionCardTone, "pending">;
}

interface PermissionCardView {
  key: string;
  toolName: string;
  summaryText: string;
  tone: PermissionCardTone;
  title: string;
  detailText?: string;
  showActions: boolean;
}

const PERMISSION_FEEDBACK_HIDE_DELAY_MS = 200;

interface ComposerActionView {
  buttonLabel: string;
  buttonType: "submit" | "interrupt";
  disabled: boolean;
}

function escapeTimelineItemKey(key: string): string {
  return key.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function splitShellTokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

export function getPermissionRequestKey(
  request: SessionSnapshot["context"]["pendingPermissionRequest"]
): string | null {
  if (!request) {
    return null;
  }

  return `${request.toolCallId}:${request.createdAt}`;
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

export function createPermissionCardFeedback(
  request: SessionSnapshot["context"]["pendingPermissionRequest"],
  reply: string
): PermissionCardFeedback | null {
  const requestKey = getPermissionRequestKey(request);
  if (!request || !requestKey) {
    return null;
  }

  return {
    requestKey,
    toolName: request.toolName,
    summaryText: request.summaryText,
    tone: reply.trim() === "取消" ? "rejected" : "approved"
  };
}

export function buildPermissionCardView(input: {
  pendingPermissionRequest: SessionSnapshot["context"]["pendingPermissionRequest"];
  feedback: PermissionCardFeedback | null;
  submitting: boolean;
}): PermissionCardView | null {
  const { pendingPermissionRequest, feedback, submitting } = input;
  const requestKey = getPermissionRequestKey(pendingPermissionRequest);

  if (feedback && (!requestKey || requestKey === feedback.requestKey)) {
    return {
      key: feedback.requestKey,
      toolName: feedback.toolName,
      summaryText: feedback.summaryText,
      tone: feedback.tone,
      title: feedback.tone === "approved" ? "已同意" : "已取消",
      showActions: false
    };
  }

  if (!pendingPermissionRequest || !requestKey) {
    return null;
  }

  return {
    key: requestKey,
    toolName: pendingPermissionRequest.toolName,
    summaryText: pendingPermissionRequest.summaryText,
    tone: "pending",
    title: "Permission Request",
    showActions: true
  };
}

export function buildComposerActionView(input: {
  canInterrupt: boolean;
  interrupting: boolean;
  canSubmit: boolean;
}): ComposerActionView {
  if (input.interrupting) {
    return {
      buttonLabel: "停止中...",
      buttonType: "interrupt",
      disabled: true
    };
  }

  if (input.canInterrupt) {
    return {
      buttonLabel: "停止执行",
      buttonType: "interrupt",
      disabled: false
    };
  }

  return {
    buttonLabel: "发送",
    buttonType: "submit",
    disabled: !input.canSubmit
  };
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
  animate,
  streaming = false,
  onAnimationComplete
}: AssistantTextBubbleProps) {
  const characters = useMemo(
    () => splitTypewriterCharacters(content),
    [content]
  );
  const totalLength = characters.length;
  const hasVisibleContent = content.trim().length > 0;
  const [visibleLength, setVisibleLength] = useState(() =>
    animate ? 0 : totalLength
  );
  const previousAnimationStateRef = useRef({
    itemKey,
    animate,
    totalLength
  });

  useEffect(() => {
    const previous = previousAnimationStateRef.current;
    setVisibleLength((current) =>
      getTypewriterVisibleLengthOnChange({
        animate,
        itemChanged: previous.itemKey !== itemKey,
        animationStarted: !previous.animate && animate,
        totalLength,
        previousTotalLength: previous.totalLength,
        currentVisibleLength: current
      })
    );
    previousAnimationStateRef.current = {
      itemKey,
      animate,
      totalLength
    };
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

  useEffect(() => {
    if (!animate || visibleLength < totalLength) {
      return;
    }

    onAnimationComplete?.(itemKey);
  }, [animate, itemKey, onAnimationComplete, totalLength, visibleLength]);

  const renderMode = getAssistantTextRenderMode({
    animate,
    streaming,
    totalLength,
    visibleLength
  });
  const isTyping = animate && visibleLength < totalLength;
  const showPlainText = renderMode === "plaintext";
  const visibleContent = showPlainText
    ? characters.slice(0, visibleLength).join("")
    : content;
  const showCursor = streaming || isTyping;

  if (!hasVisibleContent) {
    return null;
  }

  return (
    <div className="flex items-start gap-3">
      <AssistantRobotIcon />
      <div
        className={`${getBubbleClass("assistant")} min-w-0 flex-1 ${
          animate ? "[overflow-anchor:none]" : ""
        }`}
      >
        {showPlainText ? (
          <div className="min-w-0 whitespace-pre-wrap text-sm leading-7 text-inherit [overflow-wrap:anywhere]">
            {visibleContent}
            {showCursor ? (
              <span
                aria-hidden
                className="ml-1 inline-block h-[1em] w-[0.55ch] translate-y-[0.12em] animate-pulse rounded-[2px] bg-[var(--app-accent)] align-baseline"
              />
            ) : null}
          </div>
        ) : (
          <MessageMarkdown content={visibleContent} />
        )}
      </div>
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
  recentAssistantEventKeys: Set<string>,
  onAssistantAnimationComplete: (itemKey: string) => void,
  turnUsageByTurnCount: Map<number, TurnUsageSummary>
) {
  if (event.kind === "assistant_text") {
    const eventKey = getTimelineEventKey(event);
    const streaming = streamEventKeys.has(eventKey);

    return (
      <AssistantTextBubble
        key={eventKey}
        itemKey={eventKey}
        content={event.text}
        animate={streaming || recentAssistantEventKeys.has(eventKey)}
        streaming={streaming}
        onAnimationComplete={onAssistantAnimationComplete}
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

  if (event.kind === "interrupt_requested" || event.kind === "interrupted") {
    const isRequested = event.kind === "interrupt_requested";

    return (
      <article
        key={getTimelineEventKey(event)}
        className={`min-w-0 rounded-[var(--app-radius-lg)] px-4 py-4 text-sm leading-7 ${
          isRequested
            ? "bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-muted)_88%)] text-[var(--app-text-secondary)]"
            : "bg-[color:color-mix(in_srgb,var(--app-status-warning)_14%,var(--app-bg-surface)_86%)] text-[var(--app-text-secondary)]"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div
            className={`font-mono text-[0.72rem] uppercase tracking-[0.18em] ${
              isRequested
                ? "text-[var(--app-text-muted)]"
                : "text-[var(--app-status-warning)]"
            }`}
          >
            {isRequested ? "Interrupt Requested" : "Execution Interrupted"}
          </div>
          <div className="text-[0.72rem] text-[var(--app-text-muted)]">
            {formatTimestamp(event.createdAt)}
          </div>
        </div>
        <div className="mt-3">
          {isRequested
            ? "已收到停止请求，正在让当前运行尽快收尾。"
            : "当前运行已被用户中断。"}
        </div>
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
    const completedClass =
      event.status === "interrupted"
        ? "text-[var(--app-status-warning)]"
        : "text-[var(--app-status-success)]";
    const backgroundClass =
      event.status === "interrupted"
        ? "bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-muted)_88%)]"
        : "bg-[color:color-mix(in_srgb,var(--app-status-success)_12%,var(--app-bg-muted)_88%)]";

    return (
      <div
        key={getTimelineEventKey(event)}
        className={`flex items-center justify-between gap-3 rounded-[var(--app-radius-md)] px-3 py-2 text-xs text-[var(--app-text-secondary)] ${backgroundClass}`}
      >
        <span className={`font-medium ${completedClass}`}>
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
  recentAssistantEventKeys: Set<string>,
  onAssistantAnimationComplete: (itemKey: string) => void,
  turnUsageByTurnCount: Map<number, TurnUsageSummary>
): React.ReactNode {
  if (item.type === "event") {
    return renderExecutionEvent(
      item.event,
      streamEventKeys,
      recentAssistantEventKeys,
      onAssistantAnimationComplete,
      turnUsageByTurnCount
    );
  }

  if (item.type === "pending-user") {
    return renderPendingUserMessage(item.text, item.createdAt);
  }

  return renderConversationBlock(item.block);
}

function hasRenderableTimelineContent(node: React.ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

export function SessionWorkbenchConversationPanel({
  currentSession,
  loading,
  timelineItems,
  streamEventKeys,
  recentAssistantEventKeys,
  turnUsageByTurnCount,
  pendingPermissionRequest,
  message,
  submitting,
  canInterrupt,
  interrupting,
  showInterruptedHint,
  errorText,
  onMessageChange,
  onSubmit,
  onInterrupt,
  onPermissionQuickReply,
  onAssistantAnimationComplete
}: SessionWorkbenchConversationPanelProps) {
  const [copyButtonLabel, setCopyButtonLabel] = useState("复制");
  const [permissionCardFeedback, setPermissionCardFeedback] =
    useState<PermissionCardFeedback | null>(null);
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const previousScrollSnapshotRef = useRef(buildConversationScrollSnapshot([]));
  const autoFollowLatestRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const previousViewportScrollTopRef = useRef(0);
  const skipNextResizeAutoFollowRef = useRef(false);
  const resizeAutoFollowResetFrameRef = useRef<number | null>(null);
  const permissionRequestKey = getPermissionRequestKey(
    pendingPermissionRequest
  );
  const scrollSnapshot = useMemo(
    () => buildConversationScrollSnapshot(timelineItems),
    [timelineItems]
  );
  const permissionCardView = buildPermissionCardView({
    pendingPermissionRequest,
    feedback: permissionCardFeedback,
    submitting
  });
  const displayState = currentSession
    ? getSessionDisplayState({
        loopState: currentSession.sessionState.loopState,
        status: currentSession.context.status,
        pendingToolCallIds: currentSession.sessionState.pendingToolCallIds,
        interruptRequested: currentSession.sessionState.interruptRequested,
        pendingPermission: Boolean(
          currentSession.context.pendingPermissionRequest
        ),
        pendingConfirmation: Boolean(
          currentSession.context.pendingConfirmationPayload
        )
      })
    : null;
  const composerActionView = buildComposerActionView({
    canInterrupt,
    interrupting,
    canSubmit: Boolean(currentSession && message.trim() && !submitting)
  });
  const renderedTimelineItems = useMemo(
    () =>
      timelineItems
        .map((item) => ({
          item,
          content: renderTimelineItem(
            item,
            streamEventKeys,
            recentAssistantEventKeys,
            onAssistantAnimationComplete,
            turnUsageByTurnCount
          )
        }))
        .filter((entry) => hasRenderableTimelineContent(entry.content)),
    [
      timelineItems,
      streamEventKeys,
      recentAssistantEventKeys,
      onAssistantAnimationComplete,
      turnUsageByTurnCount
    ]
  );

  const scrollTimelineItemIntoView = useEffectEvent(
    (itemKey: string | null, block: "start" | "end") => {
      const viewport = conversationViewportRef.current;
      const timelineContent = timelineContentRef.current;
      if (!viewport || !timelineContent || !itemKey) {
        return;
      }

      const itemElement = timelineContent.querySelector<HTMLElement>(
        `[data-timeline-item-key="${escapeTimelineItemKey(itemKey)}"]`
      );
      if (!itemElement) {
        return;
      }

      const itemTop = itemElement.offsetTop;
      const itemBottom = itemTop + itemElement.offsetHeight;
      const nextScrollTop =
        block === "start"
          ? itemTop
          : Math.max(0, itemBottom - viewport.clientHeight);

      if (Math.abs(viewport.scrollTop - nextScrollTop) < 1) {
        previousViewportScrollTopRef.current = viewport.scrollTop;
        return;
      }

      isProgrammaticScrollRef.current = true;
      viewport.scrollTop = nextScrollTop;
      previousViewportScrollTopRef.current = nextScrollTop;
      window.requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
        previousViewportScrollTopRef.current =
          conversationViewportRef.current?.scrollTop ?? nextScrollTop;
      });
    }
  );

  const keepLatestTurnInView = useEffectEvent(() => {
    if (!autoFollowLatestRef.current) {
      return;
    }

    const targetKey =
      scrollSnapshot.latestItemKey ?? scrollSnapshot.latestTurnStartKey;
    if (!targetKey) {
      return;
    }

    scrollTimelineItemIntoView(
      targetKey,
      scrollSnapshot.latestTurnStartKey === targetKey ? "start" : "end"
    );
  });

  const clearPendingResizeAutoFollowSkip = useEffectEvent(() => {
    const frameId = resizeAutoFollowResetFrameRef.current;
    if (frameId === null) {
      return;
    }

    window.cancelAnimationFrame(frameId);
    resizeAutoFollowResetFrameRef.current = null;
  });

  const armResizeAutoFollowSkip = useEffectEvent(() => {
    skipNextResizeAutoFollowRef.current = true;
    clearPendingResizeAutoFollowSkip();
    resizeAutoFollowResetFrameRef.current = window.requestAnimationFrame(() => {
      skipNextResizeAutoFollowRef.current = false;
      resizeAutoFollowResetFrameRef.current = null;
    });
  });

  useEffect(() => {
    if (copyButtonLabel === "复制") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyButtonLabel("复制");
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [copyButtonLabel]);

  useEffect(() => {
    if (!permissionCardFeedback) {
      return;
    }

    if (
      permissionRequestKey &&
      permissionRequestKey !== permissionCardFeedback.requestKey
    ) {
      setPermissionCardFeedback(null);
    }
  }, [permissionCardFeedback, permissionRequestKey]);

  useEffect(() => {
    if (!permissionCardFeedback) {
      return;
    }

    if (permissionRequestKey === permissionCardFeedback.requestKey && !submitting) {
      setPermissionCardFeedback(null);
    }
  }, [permissionCardFeedback, permissionRequestKey, submitting]);

  useEffect(() => {
    if (!permissionCardFeedback || submitting) {
      return undefined;
    }

    if (permissionRequestKey) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPermissionCardFeedback((current) =>
        current?.requestKey === permissionCardFeedback.requestKey
          ? null
          : current
      );
    }, PERMISSION_FEEDBACK_HIDE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [permissionCardFeedback, permissionRequestKey, submitting]);

  useEffect(() => {
    if (submitting) {
      autoFollowLatestRef.current = true;
    }
  }, [submitting]);

  useEffect(() => {
    previousScrollSnapshotRef.current = buildConversationScrollSnapshot([]);
    previousViewportScrollTopRef.current = 0;
    autoFollowLatestRef.current = true;
    skipNextResizeAutoFollowRef.current = false;
    clearPendingResizeAutoFollowSkip();
  }, [currentSession?.sessionId]);

  useEffect(() => clearPendingResizeAutoFollowSkip, [clearPendingResizeAutoFollowSkip]);

  useLayoutEffect(() => {
    const intent = getConversationScrollIntent({
      previous: previousScrollSnapshotRef.current,
      next: scrollSnapshot,
      followLatest: autoFollowLatestRef.current
    });

    if (intent === "align-latest-turn") {
      armResizeAutoFollowSkip();
      scrollTimelineItemIntoView(scrollSnapshot.latestTurnAnchorKey, "start");
    } else if (intent === "follow-latest-item") {
      armResizeAutoFollowSkip();
      keepLatestTurnInView();
    }

    previousScrollSnapshotRef.current = scrollSnapshot;
  }, [
    armResizeAutoFollowSkip,
    keepLatestTurnInView,
    scrollSnapshot,
    scrollTimelineItemIntoView
  ]);

  useEffect(() => {
    const timelineContent = timelineContentRef.current;
    if (!timelineContent || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(() => {
      const resizeIntent = getConversationResizeAutoFollowIntent({
        followLatest: autoFollowLatestRef.current,
        latestItemKey: scrollSnapshot.latestItemKey,
        skipNextResizeAutoFollow: skipNextResizeAutoFollowRef.current
      });

      if (resizeIntent === "skip-once") {
        skipNextResizeAutoFollowRef.current = false;
        clearPendingResizeAutoFollowSkip();
        return;
      }

      if (resizeIntent === "none") {
        return;
      }

      keepLatestTurnInView();
    });
    resizeObserver.observe(timelineContent);

    return () => resizeObserver.disconnect();
  }, [
    clearPendingResizeAutoFollowSkip,
    keepLatestTurnInView,
    scrollSnapshot.latestItemKey
  ]);

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
    <section className="rounded-[var(--app-radius-xl)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_92%,var(--app-bg-elevated)_8%)] shadow-[var(--app-shadow-sm)] lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
      <div className="px-4 py-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 lg:min-h-0 lg:flex-1">
          <div className={getSoftBlockClass("flex flex-col gap-2")}>
            <div>
              <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                Active Session
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-0 font-mono text-[var(--app-text-primary)]">
                  {currentSession?.sessionId ?? "loading"}
                </span>
                {displayState ? (
                  <span
                    className={`rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] font-medium ${getDisplayStateToneClass(displayState.tone)}`}
                    title={displayState.detail}
                  >
                    {displayState.label}
                  </span>
                ) : null}
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

          <div
            ref={conversationViewportRef}
            className="min-h-0 flex-1 overflow-y-auto pb-80 pr-1"
            onScroll={() => {
              const viewport = conversationViewportRef.current;
              if (!viewport || isProgrammaticScrollRef.current) {
                return;
              }

              autoFollowLatestRef.current = updateConversationAutoFollowState({
                current: autoFollowLatestRef.current,
                currentScrollTop: viewport.scrollTop,
                previousScrollTop: previousViewportScrollTopRef.current,
                maxScrollTop: Math.max(
                  0,
                  viewport.scrollHeight - viewport.clientHeight
                )
              });
              previousViewportScrollTopRef.current = viewport.scrollTop;
            }}
          >
            <div ref={timelineContentRef} className="grid gap-4">
              {loading && !currentSession ? (
                <div
                  className={getSoftBlockClass(
                    "py-10 text-sm text-[var(--app-text-muted)]"
                  )}
                >
                  正在初始化工作台...
                </div>
              ) : null}

              {renderedTimelineItems.length ? (
                renderedTimelineItems.map(({ item, content }) => (
                  <div
                    key={item.key}
                    data-timeline-item-key={item.key}
                    className="min-w-0"
                  >
                    {content}
                  </div>
                ))
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
                {permissionCardView ? (
                  <div
                    key={permissionCardView.key}
                    className={`relative z-0 -mb-5 rounded-t-[var(--app-radius-lg)] rounded-b-none border-x border-t px-4 pb-6 pt-3 transition-all ${
                      permissionCardView.tone === "approved"
                        ? "border-[color:color-mix(in_srgb,var(--app-status-success)_45%,var(--app-border-subtle)_55%)] bg-[color:color-mix(in_srgb,var(--app-status-success)_10%,var(--app-bg-surface)_90%)]"
                        : permissionCardView.tone === "rejected"
                          ? "border-[color:color-mix(in_srgb,var(--app-status-danger)_42%,var(--app-border-subtle)_58%)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_9%,var(--app-bg-surface)_91%)]"
                          : "border-[color:color-mix(in_srgb,var(--app-status-warning)_56%,var(--app-border-subtle)_44%)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_14%,var(--app-bg-surface)_86%)]"
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div
                          className={`font-mono text-[0.65rem] uppercase tracking-[0.16em] ${
                            permissionCardView.tone === "approved"
                              ? "text-[var(--app-status-success)]"
                              : permissionCardView.tone === "rejected"
                                ? "text-[var(--app-status-danger)]"
                                : "text-[var(--app-text-muted)]"
                          }`}
                        >
                          {permissionCardView.title}
                        </div>
                        <div className="mt-1 text-sm font-medium leading-6 text-[var(--app-text-primary)]">
                          {permissionCardView.summaryText}
                        </div>
                        {permissionCardView.detailText ? (
                          <div
                            className={`mt-1 text-xs ${
                              permissionCardView.tone === "approved"
                                ? "text-[var(--app-status-success)]"
                                : permissionCardView.tone === "rejected"
                                  ? "text-[var(--app-status-danger)]"
                                  : "text-[var(--app-text-muted)]"
                            }`}
                          >
                            {permissionCardView.detailText}
                          </div>
                        ) : null}
                      </div>

                      {permissionCardView.showActions ? (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {buildPermissionQuickReplies(
                            pendingPermissionRequest
                          ).map((option) => (
                            <button
                              key={option.reply}
                              type="button"
                              onClick={() => {
                                setPermissionCardFeedback(
                                  createPermissionCardFeedback(
                                    pendingPermissionRequest,
                                    option.reply
                                  )
                                );
                                onPermissionQuickReply(option.reply);
                              }}
                              disabled={submitting}
                              className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {option.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setPermissionCardFeedback(
                                createPermissionCardFeedback(
                                  pendingPermissionRequest,
                                  "取消"
                                )
                              );
                              onPermissionQuickReply("取消");
                            }}
                            disabled={submitting}
                            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div
                          className={`rounded-[var(--app-radius-pill)] border px-2.5 py-1 text-[0.68rem] uppercase tracking-[0.14em] ${
                            permissionCardView.tone === "approved"
                              ? "border-[var(--app-status-success)] text-[var(--app-status-success)]"
                              : "border-[var(--app-status-danger)] text-[var(--app-status-danger)]"
                          }`}
                        >
                          {permissionCardView.tone === "approved"
                            ? "执行中"
                            : "已取消"}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                <textarea
                  value={message}
                  onChange={(event) => onMessageChange(event.target.value)}
                  rows={3}
                  placeholder="输入你的请求"
                  className={`relative z-10 w-full resize-none border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-4 py-3 text-sm leading-7 text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)] ${permissionCardView ? "-mt-2 rounded-[var(--app-radius-lg)]" : "rounded-[var(--app-radius-lg)]"}`}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[0.72rem]">
                    {submitting ? (
                      <span className="text-xs text-[var(--app-text-muted)]">
                        正在接收当前响应...
                      </span>
                    ) : null}
                    {showInterruptedHint ? (
                      <span className="text-xs text-[var(--app-status-warning)]">
                        本次执行已中断，可直接继续输入下一条消息。
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
                      type={
                        composerActionView.buttonType === "submit"
                          ? "submit"
                          : "button"
                      }
                      onClick={
                        composerActionView.buttonType === "interrupt"
                          ? onInterrupt
                          : undefined
                      }
                      disabled={composerActionView.disabled}
                      className={`inline-flex items-center justify-center rounded-[var(--app-radius-pill)] px-5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        composerActionView.buttonType === "interrupt"
                          ? "border border-[var(--app-status-danger)] text-[var(--app-status-danger)] hover:bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,transparent)]"
                          : "border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] text-[var(--app-text-primary)] hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)]"
                      }`}
                    >
                      {composerActionView.buttonLabel}
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
