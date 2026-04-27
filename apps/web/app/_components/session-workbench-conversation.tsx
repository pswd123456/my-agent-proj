"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent
} from "react";

import type {
  ModelCatalogEntry,
  RunStreamEvent,
  SessionSnapshot
} from "@ai-app-template/sdk";

import { MessageMarkdown } from "./message-markdown";
import { SessionTodoPanel } from "./session-todo-panel";
import {
  getAssistantTextCursorVisible,
  getAssistantTextRenderMode,
  getNextTypewriterLength,
  getTypewriterVisibleLengthOnChange,
  splitTypewriterCharacters,
  TYPEWRITER_FRAME_MS
} from "./message-typewriter";
import {
  buildConversationViewItems,
  getCompactCollapsedFlowAnchors,
  getCompactCollapsedFlowScrollTargetKey,
  type CompactCollapsedFlowViewItem,
  type CompactFileBatchViewItem,
  type CompactToolViewItem,
  type ConversationViewItem
} from "./session-conversation-view";
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
  getPeakTurnContextTokens,
  getBubbleClass,
  getDebugPreClass,
  getInspectorCardClass,
  getSoftBlockClass,
  stringify
} from "./session-workbench-shared";

interface SessionWorkbenchConversationPanelProps {
  currentSession: SessionSnapshot | null;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  todoUpdating: boolean;
  loading: boolean;
  timelineItems: TimelineItem[];
  streamEventKeys: Set<string>;
  recentAssistantEventKeys: Set<string>;
  turnUsageByTurnCount: Map<number, TurnUsageSummary>;
  debugConversationView: boolean;
  pendingPermissionRequest: SessionSnapshot["context"]["pendingPermissionRequest"];
  pendingUserQuestionPayload: SessionSnapshot["context"]["pendingUserQuestionPayload"];
  message: string;
  submitting: boolean;
  canInterrupt: boolean;
  interrupting: boolean;
  showInterruptedHint: boolean;
  errorText: string | null;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInterrupt: () => void;
  onSettingsModelChange: (model: string) => void;
  onSessionPlanModeChange: (checked: boolean) => void;
  onPermissionQuickReply: (reply: string) => void;
  onUserQuestionQuickReply: (reply: string) => void;
  onAssistantAnimationComplete: (itemKey: string) => void;
  headerActions?: ReactNode;
}

interface AssistantTextBubbleProps {
  content: string;
  itemKey: string;
  animate: boolean;
  labelTimestamp?: string | undefined;
  streaming?: boolean;
  onAnimationComplete?: (itemKey: string) => void;
}

interface TypewriterTextContentProps {
  content: string;
  itemKey: string;
  animate: boolean;
  streaming?: boolean;
  renderMarkdownWhenSettled?: boolean;
  className: string;
  onAnimationComplete?: (itemKey: string) => void;
}

type MessageRole = "user" | "assistant";

export function getCompactToolFileChangeRows(
  item: Pick<CompactToolViewItem, "fileChanges">
): Array<{
  path: string;
  action: "modify" | "create" | "delete";
  countsLabel: string;
  diff: string;
}> {
  return (item.fileChanges ?? []).map((file) => ({
    path: file.path,
    action: file.action,
    countsLabel: `+${file.addedLineCount} / -${file.removedLineCount}`,
    diff: file.diff
  }));
}

function MessageRoleLabel({
  role,
  timestamp
}: {
  role: MessageRole;
  timestamp?: string | undefined;
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
      <span>{role === "user" ? "USER" : "ASSISTANT"}</span>
      {timestamp ? (
        <span className="tracking-[0.08em]">{formatTimestamp(timestamp)}</span>
      ) : null}
    </div>
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

interface UserQuestionCardView {
  key: string;
  questionText: string;
  options: NonNullable<
    SessionSnapshot["context"]["pendingUserQuestionPayload"]
  >["options"];
  contextNote?: string;
}

const PERMISSION_FEEDBACK_HIDE_DELAY_MS = 200;
const AUTO_COLLAPSE_ANIMATION_MS = 240;
const COLLAPSE_SCROLL_TOP_OFFSET_PX = 20;
const SMOOTH_SCROLL_DURATION_MS = 320;

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

export function buildPermissionQuickReplies(
  request: SessionSnapshot["context"]["pendingPermissionRequest"]
): Array<{ label: string; reply: string }> {
  if (!request) {
    return [];
  }

  if (request.allowWorkspaceEscape) {
    return [
      {
        label: "本会话允许 workspace 外文件操作",
        reply: "本会话允许 workspace 外文件操作"
      }
    ];
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
}): PermissionCardView | null {
  const { pendingPermissionRequest, feedback } = input;
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

export function getUserQuestionKey(
  payload: SessionSnapshot["context"]["pendingUserQuestionPayload"]
): string | null {
  if (!payload) {
    return null;
  }

  return payload.createdAt;
}

export function buildUserQuestionCardView(
  payload: SessionSnapshot["context"]["pendingUserQuestionPayload"]
): UserQuestionCardView | null {
  const key = getUserQuestionKey(payload);
  if (!payload || !key) {
    return null;
  }

  return {
    key,
    questionText: payload.questionText,
    options: payload.options,
    ...(payload.contextNote ? { contextNote: payload.contextNote } : {})
  };
}

function renderUserMessageBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "user" }>
) {
  return (
    <div key={block.id} className="flex flex-col items-end gap-1">
      <MessageRoleLabel role="user" timestamp={block.createdAt} />
      <div className={getBubbleClass("user")}>{block.content}</div>
    </div>
  );
}

function TypewriterTextContent({
  content,
  itemKey,
  animate,
  streaming = false,
  renderMarkdownWhenSettled = true,
  className,
  onAnimationComplete
}: TypewriterTextContentProps) {
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
  const showPlainText =
    !renderMarkdownWhenSettled || renderMode === "plaintext";
  const visibleContent = showPlainText
    ? characters.slice(0, visibleLength).join("")
    : content;
  const showCursor = getAssistantTextCursorVisible({
    animate,
    totalLength,
    visibleLength
  });

  if (!hasVisibleContent) {
    return null;
  }

  return (
    <div className={className}>
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
  );
}

function AssistantTextBubble({
  content,
  itemKey,
  animate,
  labelTimestamp,
  streaming = false,
  onAnimationComplete
}: AssistantTextBubbleProps) {
  return (
    <div className="flex flex-col items-start gap-1">
      <MessageRoleLabel role="assistant" timestamp={labelTimestamp} />
      <TypewriterTextContent
        content={content}
        itemKey={itemKey}
        animate={animate}
        streaming={streaming}
        className={`${getBubbleClass("assistant")} min-w-0 ${
          animate ? "[overflow-anchor:none]" : ""
        }`}
        {...(onAnimationComplete ? { onAnimationComplete } : {})}
      />
    </div>
  );
}

function renderAssistantMessageBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "assistant" }>,
  showTimestamp = false
) {
  return (
    <AssistantTextBubble
      key={block.id}
      itemKey={block.id}
      content={block.content}
      animate={false}
      labelTimestamp={showTimestamp ? block.createdAt : undefined}
    />
  );
}

function renderAssistantThinkingBlock(
  block: Extract<
    SessionSnapshot["messages"][number],
    { kind: "assistant thinking" }
  >
) {
  return (
    <article
      key={block.id}
      className={getInspectorCardClass(
        "text-sm leading-7 text-[var(--app-text-muted)]"
      )}
    >
      <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
        Thinking
      </div>
      <div className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {block.content}
      </div>
    </article>
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

function renderConversationBlock(
  block: SessionSnapshot["messages"][number],
  timestampedAssistantMessageIds: Set<string>
) {
  if (block.kind === "user") {
    return renderUserMessageBlock(block);
  }

  if (block.kind === "assistant") {
    return renderAssistantMessageBlock(
      block,
      timestampedAssistantMessageIds.has(block.id)
    );
  }

  if (block.kind === "assistant thinking") {
    return renderAssistantThinkingBlock(block);
  }

  if (block.kind === "tool call") {
    return renderToolCallBlock(block);
  }

  return renderToolResultBlock(block);
}

function renderPendingUserMessage(text: string, createdAt: string) {
  return (
    <div
      key={`pending-user-${createdAt}`}
      className="flex flex-col items-end gap-1"
    >
      <MessageRoleLabel role="user" timestamp={createdAt} />
      <div className={getBubbleClass("user")}>{text}</div>
    </div>
  );
}

function renderExecutionEvent(
  event: RunStreamEvent,
  streamEventKeys: Set<string>,
  recentAssistantEventKeys: Set<string>,
  timestampedAssistantEventKeys: Set<string>,
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
        labelTimestamp={
          timestampedAssistantEventKeys.has(eventKey)
            ? event.createdAt
            : undefined
        }
        streaming={streaming}
        onAnimationComplete={onAssistantAnimationComplete}
      />
    );
  }

  if (event.kind === "thinking") {
    const eventKey = getTimelineEventKey(event);
    const streaming = streamEventKeys.has(eventKey);

    return (
      <article
        key={eventKey}
        className={getInspectorCardClass(
          "text-sm leading-7 text-[var(--app-text-muted)]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Thinking
          </div>
        </div>
        <TypewriterTextContent
          content={event.text}
          itemKey={eventKey}
          animate={streaming || recentAssistantEventKeys.has(eventKey)}
          streaming={streaming}
          renderMarkdownWhenSettled={false}
          className="mt-3 text-[var(--app-text-muted)]"
          onAnimationComplete={onAssistantAnimationComplete}
        />
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
  timestampedAssistantEventKeys: Set<string>,
  timestampedAssistantMessageIds: Set<string>,
  onAssistantAnimationComplete: (itemKey: string) => void,
  turnUsageByTurnCount: Map<number, TurnUsageSummary>
): React.ReactNode {
  if (item.type === "event") {
    return renderExecutionEvent(
      item.event,
      streamEventKeys,
      recentAssistantEventKeys,
      timestampedAssistantEventKeys,
      onAssistantAnimationComplete,
      turnUsageByTurnCount
    );
  }

  if (item.type === "pending-user") {
    return renderPendingUserMessage(item.text, item.createdAt);
  }

  return renderConversationBlock(item.block, timestampedAssistantMessageIds);
}

function renderCompactToolItem(
  item: CompactToolViewItem,
  expanded: boolean,
  onToggleExpanded: (key: string) => void,
  renderNestedItems: (items: ConversationViewItem[]) => React.ReactNode
) {
  const fileChangeRows = getCompactToolFileChangeRows(item);

  return (
    <article key={item.key} className={getInspectorCardClass()}>
      <button
        type="button"
        onClick={() => onToggleExpanded(item.key)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Tool
          </div>
          <div className="mt-2 min-w-0 text-sm font-medium text-[var(--app-text-primary)] [overflow-wrap:anywhere]">
            {item.title}
          </div>
          {fileChangeRows.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {fileChangeRows.map((file) => (
                <div
                  key={`${item.key}-${file.path}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-[var(--app-text-secondary)]"
                >
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {file.path}
                  </span>
                  <span className="shrink-0 font-mono text-[0.72rem] text-[var(--app-text-muted)]">
                    {file.countsLabel}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <span className="shrink-0 text-[0.72rem] text-[var(--app-text-muted)]">
          {expanded ? "收起" : "展开"}
        </span>
      </button>
      <div
        aria-hidden={!expanded}
        className={`grid transition-[grid-template-rows,opacity,margin-top] duration-200 ease-[var(--app-ease-standard)] ${
          expanded
            ? "mt-3 grid-rows-[1fr] opacity-100"
            : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {fileChangeRows.length > 0 ? (
            <div className="grid gap-3">
              {fileChangeRows.map((file) => (
                <section
                  key={`${item.key}-${file.path}-diff`}
                  className="grid gap-2 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-5">
                    <span className="min-w-0 flex-1 font-medium text-[var(--app-text-primary)] [overflow-wrap:anywhere]">
                      {file.path}
                    </span>
                    <span className="shrink-0 font-mono text-[0.72rem] text-[var(--app-text-muted)]">
                      {file.countsLabel}
                    </span>
                  </div>
                  <pre
                    className={getDebugPreClass("surface").replace("mt-2 ", "")}
                  >
                    {file.diff}
                  </pre>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid gap-3">
              {renderNestedItems(item.originalItems)}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function renderCompactFileBatchItem(
  item: CompactFileBatchViewItem,
  expanded: boolean,
  onToggleExpanded: (key: string) => void,
  renderNestedItems: (items: ConversationViewItem[]) => React.ReactNode
) {
  return (
    <article key={item.key} className={getInspectorCardClass()}>
      <button
        type="button"
        onClick={() => onToggleExpanded(item.key)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Files
          </div>
          <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
            {item.title}
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-1 text-xs leading-5 text-[var(--app-text-muted)]">
            {item.targets.map((target) => (
              <div key={target} className="min-w-0 [overflow-wrap:anywhere]">
                {target}
              </div>
            ))}
          </div>
          {renderNestedItems(item.originalItems)}
        </div>
      ) : null}
    </article>
  );
}

function renderCompactCollapsedFlowItem(
  item: CompactCollapsedFlowViewItem,
  expanded: boolean,
  autoCollapseOnMount: boolean,
  onToggleExpanded: (key: string) => void,
  onAutoCollapseComplete: (key: string) => void,
  renderNestedItems: (items: ConversationViewItem[]) => React.ReactNode
) {
  return (
    <CompactCollapsedFlowCard
      item={item}
      expanded={expanded}
      autoCollapseOnMount={autoCollapseOnMount}
      onToggleExpanded={onToggleExpanded}
      onAutoCollapseComplete={onAutoCollapseComplete}
      renderNestedItems={renderNestedItems}
    />
  );
}

function CompactCollapsedFlowCard(props: {
  item: CompactCollapsedFlowViewItem;
  expanded: boolean;
  autoCollapseOnMount: boolean;
  onToggleExpanded: (key: string) => void;
  onAutoCollapseComplete: (key: string) => void;
  renderNestedItems: (items: ConversationViewItem[]) => React.ReactNode;
}) {
  const {
    item,
    expanded,
    autoCollapseOnMount,
    onToggleExpanded,
    onAutoCollapseComplete,
    renderNestedItems
  } = props;
  const [autoCollapsed, setAutoCollapsed] = useState(
    () => !autoCollapseOnMount
  );

  useEffect(() => {
    if (!autoCollapseOnMount) {
      setAutoCollapsed(true);
      return undefined;
    }

    setAutoCollapsed(false);
    const frameId = window.requestAnimationFrame(() => {
      setAutoCollapsed(true);
    });
    const timeoutId = window.setTimeout(() => {
      onAutoCollapseComplete(item.key);
    }, AUTO_COLLAPSE_ANIMATION_MS);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [autoCollapseOnMount, item.key, onAutoCollapseComplete]);

  const showExpandedContent =
    expanded || (autoCollapseOnMount && !autoCollapsed);

  return (
    <article
      key={item.key}
      className="min-w-0 rounded-[var(--app-radius-lg)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_82%,transparent)] px-4 py-3 text-sm text-[var(--app-text-secondary)]"
    >
      <button
        type="button"
        onClick={() => onToggleExpanded(item.key)}
        disabled={autoCollapseOnMount && !autoCollapsed}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>前面还有 {item.hiddenCount} 条消息</span>
        <span className="shrink-0 text-[0.72rem] text-[var(--app-text-muted)]">
          {showExpandedContent ? "收起" : "展开"}
        </span>
      </button>
      <div
        aria-hidden={!showExpandedContent}
        className={`grid transition-[grid-template-rows,opacity,margin-top] duration-200 ease-[var(--app-ease-standard)] ${
          showExpandedContent
            ? "mt-3 grid-rows-[1fr] opacity-100"
            : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-3">
            {renderNestedItems(item.originalItems)}
          </div>
        </div>
      </div>
    </article>
  );
}

function renderConversationViewItem(
  item: ConversationViewItem,
  input: {
    streamEventKeys: Set<string>;
    recentAssistantEventKeys: Set<string>;
    timestampedAssistantEventKeys: Set<string>;
    timestampedAssistantMessageIds: Set<string>;
    hiddenItemKeys: Set<string>;
    autoCollapseKeys: Set<string>;
    onAssistantAnimationComplete: (itemKey: string) => void;
    turnUsageByTurnCount: Map<number, TurnUsageSummary>;
    expandedKeys: Set<string>;
    onToggleExpanded: (key: string) => void;
    onAutoCollapseComplete: (key: string) => void;
  }
): React.ReactNode {
  const renderNestedItems = (items: ConversationViewItem[]) =>
    items.map((nestedItem) => (
      <div key={nestedItem.key} className="min-w-0">
        {renderConversationViewItem(nestedItem, input)}
      </div>
    ));

  if (input.hiddenItemKeys.has(item.key)) {
    return null;
  }

  if (item.type === "timeline") {
    return renderTimelineItem(
      item.item,
      input.streamEventKeys,
      input.recentAssistantEventKeys,
      input.timestampedAssistantEventKeys,
      input.timestampedAssistantMessageIds,
      input.onAssistantAnimationComplete,
      input.turnUsageByTurnCount
    );
  }

  const expanded = input.expandedKeys.has(item.key);

  if (item.type === "compact-tool") {
    return renderCompactToolItem(
      item,
      expanded,
      input.onToggleExpanded,
      renderNestedItems
    );
  }

  if (item.type === "compact-file-batch") {
    return renderCompactFileBatchItem(
      item,
      expanded,
      input.onToggleExpanded,
      renderNestedItems
    );
  }

  return renderCompactCollapsedFlowItem(
    item,
    expanded,
    input.autoCollapseKeys.has(item.key),
    input.onToggleExpanded,
    input.onAutoCollapseComplete,
    renderNestedItems
  );
}

function getConversationViewEvent(
  item: ConversationViewItem
): RunStreamEvent | null {
  if (item.type === "timeline" && item.item.type === "event") {
    return item.item.event;
  }

  return null;
}

function getConversationViewAssistantMessageId(
  item: ConversationViewItem
): string | null {
  if (
    item.type === "timeline" &&
    item.item.type === "message" &&
    item.item.block.kind === "assistant"
  ) {
    return item.item.block.id;
  }

  return null;
}

function getConversationViewTurnCount(
  item: ConversationViewItem
): number | null {
  const event = getConversationViewEvent(item);
  if (event && "turnCount" in event) {
    return event.turnCount;
  }

  if (item.type === "compact-tool") {
    const firstEvent = item.originalItems
      .map(getConversationViewEvent)
      .find((nestedEvent): nestedEvent is RunStreamEvent =>
        Boolean(nestedEvent && "turnCount" in nestedEvent)
      );
    return firstEvent && "turnCount" in firstEvent
      ? firstEvent.turnCount
      : null;
  }

  if (item.type === "compact-file-batch") {
    const firstTool = item.originalItems.find(
      (nestedItem): nestedItem is CompactToolViewItem =>
        nestedItem.type === "compact-tool"
    );
    return firstTool ? getConversationViewTurnCount(firstTool) : null;
  }

  return null;
}

function shouldInvalidateAssistantFinalCandidate(
  item: ConversationViewItem
): boolean {
  const event = getConversationViewEvent(item);
  if (!event) {
    return item.type !== "timeline";
  }

  return (
    event.kind !== "turn_end" &&
    event.kind !== "run_complete" &&
    event.kind !== "assistant_text"
  );
}

function getTimestampedAssistantKeys(items: ConversationViewItem[]): {
  eventKeys: Set<string>;
  messageIds: Set<string>;
} {
  const eventKeys = new Set<string>();
  const messageIds = new Set<string>();
  let currentTurnCount: number | null = null;
  let finalAssistantCandidate:
    | { kind: "event"; key: string }
    | { kind: "message"; id: string }
    | null = null;

  function flushCurrentTurn() {
    if (!finalAssistantCandidate) {
      return;
    }

    if (finalAssistantCandidate.kind === "event") {
      eventKeys.add(finalAssistantCandidate.key);
    } else {
      messageIds.add(finalAssistantCandidate.id);
    }
  }

  for (const item of items) {
    const itemTurnCount = getConversationViewTurnCount(item);
    if (itemTurnCount !== null && itemTurnCount !== currentTurnCount) {
      flushCurrentTurn();
      currentTurnCount = itemTurnCount;
      finalAssistantCandidate = null;
    }

    const event = getConversationViewEvent(item);
    if (event?.kind === "assistant_text") {
      finalAssistantCandidate = {
        kind: "event",
        key: getTimelineEventKey(event)
      };
      continue;
    }

    const assistantMessageId = getConversationViewAssistantMessageId(item);
    if (assistantMessageId) {
      finalAssistantCandidate = {
        kind: "message",
        id: assistantMessageId
      };
      continue;
    }

    if (shouldInvalidateAssistantFinalCandidate(item)) {
      finalAssistantCandidate = null;
    }
  }

  flushCurrentTurn();

  return { eventKeys, messageIds };
}

function hasRenderableTimelineContent(node: React.ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

export function SessionWorkbenchConversationPanel({
  currentSession,
  modelCatalog,
  selectedModelId,
  todoUpdating,
  loading,
  timelineItems,
  streamEventKeys,
  recentAssistantEventKeys,
  turnUsageByTurnCount,
  debugConversationView,
  pendingPermissionRequest,
  pendingUserQuestionPayload,
  message,
  submitting,
  canInterrupt,
  interrupting,
  showInterruptedHint,
  errorText,
  onMessageChange,
  onSubmit,
  onInterrupt,
  onSettingsModelChange,
  onSessionPlanModeChange,
  onPermissionQuickReply,
  onUserQuestionQuickReply,
  onAssistantAnimationComplete,
  headerActions
}: SessionWorkbenchConversationPanelProps) {
  const [copyButtonLabel, setCopyButtonLabel] = useState("复制");
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [permissionCardFeedback, setPermissionCardFeedback] =
    useState<PermissionCardFeedback | null>(null);
  const [expandedCompactItemKeys, setExpandedCompactItemKeys] = useState<
    Set<string>
  >(new Set());
  const [autoCollapsingItemKeys, setAutoCollapsingItemKeys] = useState<
    Set<string>
  >(new Set());
  const seenCollapsedFlowKeysRef = useRef<Set<string>>(new Set());
  const pendingCollapsedFlowScrollTargetRef = useRef<string | null>(null);
  const pendingAssistantRevealSkipKeyRef = useRef<string | null>(null);
  const quickActionsRef = useRef<HTMLDivElement | null>(null);
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const previousScrollSnapshotRef = useRef(buildConversationScrollSnapshot([]));
  const autoFollowLatestRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const previousViewportScrollTopRef = useRef(0);
  const skipNextResizeAutoFollowRef = useRef(false);
  const resizeAutoFollowResetFrameRef = useRef<number | null>(null);
  const smoothScrollResetTimeoutRef = useRef<number | null>(null);
  const permissionRequestKey = getPermissionRequestKey(
    pendingPermissionRequest
  );
  const userQuestionCardView = buildUserQuestionCardView(
    pendingUserQuestionPayload
  );
  const conversationViewItems = useMemo(
    () =>
      buildConversationViewItems({
        timelineItems,
        mode: debugConversationView ? "debug" : "compact"
      }),
    [debugConversationView, timelineItems]
  );
  const collapsedFlowAnchorsByKey = useMemo(() => {
    const next = new Map<
      string,
      { scrollTargetKey: string | null; assistantItemKey: string | null }
    >();

    for (const item of conversationViewItems) {
      if (item.type !== "compact-collapsed-flow") {
        continue;
      }

      next.set(
        item.key,
        getCompactCollapsedFlowAnchors({
          items: conversationViewItems,
          collapsedFlowKey: item.key
        })
      );
    }

    return next;
  }, [conversationViewItems]);
  const hiddenAssistantItemKeys = useMemo(() => {
    const next = new Set<string>();

    for (const key of autoCollapsingItemKeys) {
      const assistantItemKey =
        collapsedFlowAnchorsByKey.get(key)?.assistantItemKey;
      if (assistantItemKey) {
        next.add(assistantItemKey);
      }
    }

    return next;
  }, [autoCollapsingItemKeys, collapsedFlowAnchorsByKey]);
  const visibleConversationViewItems = useMemo(
    () =>
      conversationViewItems.filter(
        (item) => !hiddenAssistantItemKeys.has(item.key)
      ),
    [conversationViewItems, hiddenAssistantItemKeys]
  );
  const scrollItems = useMemo(
    () =>
      visibleConversationViewItems.map((item) => {
        if (item.type === "timeline" && item.item.type === "event") {
          return {
            key: item.key,
            type: "event",
            event: item.item.event
          };
        }

        return {
          key: item.key,
          type: item.type
        };
      }),
    [visibleConversationViewItems]
  );
  const scrollSnapshot = useMemo(
    () => buildConversationScrollSnapshot(scrollItems),
    [scrollItems]
  );
  const timestampedAssistantKeys = useMemo(
    () => getTimestampedAssistantKeys(conversationViewItems),
    [conversationViewItems]
  );
  const permissionCardView = buildPermissionCardView({
    pendingPermissionRequest,
    feedback: permissionCardFeedback
  });
  const composerActionView = buildComposerActionView({
    canInterrupt,
    interrupting,
    canSubmit: Boolean(currentSession && message.trim() && !submitting)
  });
  const peakTurnContextTokens = useMemo(
    () => getPeakTurnContextTokens(turnUsageByTurnCount),
    [turnUsageByTurnCount]
  );
  const renderedTimelineItems = useMemo(
    () =>
      visibleConversationViewItems
        .map((item) => ({
          item,
          content: renderConversationViewItem(item, {
            streamEventKeys,
            recentAssistantEventKeys,
            timestampedAssistantEventKeys: timestampedAssistantKeys.eventKeys,
            timestampedAssistantMessageIds: timestampedAssistantKeys.messageIds,
            hiddenItemKeys: hiddenAssistantItemKeys,
            autoCollapseKeys: autoCollapsingItemKeys,
            onAssistantAnimationComplete,
            turnUsageByTurnCount,
            expandedKeys: expandedCompactItemKeys,
            onToggleExpanded: (key) => {
              setExpandedCompactItemKeys((current) => {
                const next = new Set(current);
                if (next.has(key)) {
                  next.delete(key);
                  const scrollTargetKey =
                    getCompactCollapsedFlowScrollTargetKey({
                      items: conversationViewItems,
                      collapsedFlowKey: key
                    }) ?? null;
                  if (scrollTargetKey) {
                    pendingCollapsedFlowScrollTargetRef.current =
                      scrollTargetKey;
                  }
                } else {
                  next.add(key);
                }
                return next;
              });
            },
            onAutoCollapseComplete: (key) => {
              const assistantItemKey =
                collapsedFlowAnchorsByKey.get(key)?.assistantItemKey ?? null;
              if (assistantItemKey) {
                pendingAssistantRevealSkipKeyRef.current = assistantItemKey;
              }
              setAutoCollapsingItemKeys((current) => {
                if (!current.has(key)) {
                  return current;
                }

                const next = new Set(current);
                next.delete(key);
                return next;
              });
            }
          })
        }))
        .filter((entry) => hasRenderableTimelineContent(entry.content)),
    [
      visibleConversationViewItems,
      streamEventKeys,
      recentAssistantEventKeys,
      timestampedAssistantKeys,
      hiddenAssistantItemKeys,
      autoCollapsingItemKeys,
      onAssistantAnimationComplete,
      turnUsageByTurnCount,
      expandedCompactItemKeys,
      conversationViewItems,
      collapsedFlowAnchorsByKey
    ]
  );

  const scrollTimelineItemIntoView = useEffectEvent(
    (
      itemKey: string | null,
      options?: {
        block?: "start" | "end";
        behavior?: "instant" | "smooth";
        topOffsetPx?: number;
      }
    ) => {
      const viewport = conversationViewportRef.current;
      const timelineContent = timelineContentRef.current;
      if (!viewport || !timelineContent || !itemKey) {
        return;
      }

      const {
        block = "end",
        behavior = "instant",
        topOffsetPx = 0
      } = options ?? {};

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
          ? Math.max(0, itemTop - topOffsetPx)
          : Math.max(0, itemBottom - viewport.clientHeight);

      if (Math.abs(viewport.scrollTop - nextScrollTop) < 1) {
        previousViewportScrollTopRef.current = viewport.scrollTop;
        return;
      }

      isProgrammaticScrollRef.current = true;
      if (smoothScrollResetTimeoutRef.current !== null) {
        window.clearTimeout(smoothScrollResetTimeoutRef.current);
        smoothScrollResetTimeoutRef.current = null;
      }

      if (behavior === "smooth" && typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: nextScrollTop,
          behavior: "smooth"
        });
        smoothScrollResetTimeoutRef.current = window.setTimeout(() => {
          isProgrammaticScrollRef.current = false;
          previousViewportScrollTopRef.current =
            conversationViewportRef.current?.scrollTop ?? nextScrollTop;
          smoothScrollResetTimeoutRef.current = null;
        }, SMOOTH_SCROLL_DURATION_MS);
      } else {
        viewport.scrollTop = nextScrollTop;
        window.requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false;
          previousViewportScrollTopRef.current =
            conversationViewportRef.current?.scrollTop ?? nextScrollTop;
        });
      }

      previousViewportScrollTopRef.current = nextScrollTop;
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

    scrollTimelineItemIntoView(targetKey, {
      block: scrollSnapshot.latestTurnStartKey === targetKey ? "start" : "end"
    });
  });

  const clearPendingResizeAutoFollowSkip = useEffectEvent(() => {
    const frameId = resizeAutoFollowResetFrameRef.current;
    if (frameId === null) {
      return;
    }

    window.cancelAnimationFrame(frameId);
    resizeAutoFollowResetFrameRef.current = null;
  });

  const clearPendingSmoothScrollReset = useEffectEvent(() => {
    const timeoutId = smoothScrollResetTimeoutRef.current;
    if (timeoutId === null) {
      return;
    }

    window.clearTimeout(timeoutId);
    smoothScrollResetTimeoutRef.current = null;
    isProgrammaticScrollRef.current = false;
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

    if (
      permissionRequestKey === permissionCardFeedback.requestKey &&
      !submitting
    ) {
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
    if (!quickActionsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const container = quickActionsRef.current;
      if (!container || container.contains(event.target as Node)) {
        return;
      }

      setQuickActionsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setQuickActionsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [quickActionsOpen]);

  useEffect(() => {
    if (submitting) {
      autoFollowLatestRef.current = true;
    }
  }, [submitting]);

  useEffect(() => {
    setQuickActionsOpen(false);
  }, [currentSession?.sessionId]);

  useEffect(() => {
    const currentCollapsedKeys = new Set(
      conversationViewItems
        .filter((item) => item.type === "compact-collapsed-flow")
        .map((item) => item.key)
    );

    previousScrollSnapshotRef.current = buildConversationScrollSnapshot([]);
    previousViewportScrollTopRef.current = 0;
    autoFollowLatestRef.current = true;
    skipNextResizeAutoFollowRef.current = false;
    seenCollapsedFlowKeysRef.current = currentCollapsedKeys;
    pendingCollapsedFlowScrollTargetRef.current = null;
    pendingAssistantRevealSkipKeyRef.current = null;
    setExpandedCompactItemKeys(new Set());
    setAutoCollapsingItemKeys(new Set());
    clearPendingResizeAutoFollowSkip();
    clearPendingSmoothScrollReset();
  }, [currentSession?.sessionId, debugConversationView]);

  useEffect(() => {
    const nextAutoCollapseKeys: string[] = [];

    for (const item of conversationViewItems) {
      if (item.type !== "compact-collapsed-flow") {
        continue;
      }

      if (seenCollapsedFlowKeysRef.current.has(item.key)) {
        continue;
      }

      seenCollapsedFlowKeysRef.current.add(item.key);
      nextAutoCollapseKeys.push(item.key);
    }

    if (nextAutoCollapseKeys.length === 0) {
      return;
    }

    const lastKey = nextAutoCollapseKeys.at(-1) ?? null;
    if (lastKey) {
      const scrollTargetKey =
        collapsedFlowAnchorsByKey.get(lastKey)?.scrollTargetKey ?? null;
      if (scrollTargetKey) {
        pendingCollapsedFlowScrollTargetRef.current = scrollTargetKey;
      }
    }

    setAutoCollapsingItemKeys((current) => {
      const next = new Set(current);
      for (const key of nextAutoCollapseKeys) {
        next.add(key);
      }
      return next;
    });
  }, [collapsedFlowAnchorsByKey, conversationViewItems]);

  useEffect(() => {
    return () => {
      clearPendingResizeAutoFollowSkip();
      clearPendingSmoothScrollReset();
    };
  }, []);

  useLayoutEffect(() => {
    const intent = getConversationScrollIntent({
      previous: previousScrollSnapshotRef.current,
      next: scrollSnapshot,
      followLatest: autoFollowLatestRef.current
    });

    if (
      intent === "follow-latest-item" &&
      pendingAssistantRevealSkipKeyRef.current &&
      pendingAssistantRevealSkipKeyRef.current === scrollSnapshot.latestItemKey
    ) {
      pendingAssistantRevealSkipKeyRef.current = null;
      armResizeAutoFollowSkip();
      previousScrollSnapshotRef.current = scrollSnapshot;
      return;
    }

    if (intent === "align-latest-turn") {
      armResizeAutoFollowSkip();
      scrollTimelineItemIntoView(scrollSnapshot.latestTurnAnchorKey, {
        block: "start"
      });
    } else if (intent === "follow-latest-item") {
      armResizeAutoFollowSkip();
      keepLatestTurnInView();
    }

    previousScrollSnapshotRef.current = scrollSnapshot;
  }, [scrollSnapshot]);

  useLayoutEffect(() => {
    const targetKey = pendingCollapsedFlowScrollTargetRef.current;
    if (!targetKey) {
      return;
    }

    pendingCollapsedFlowScrollTargetRef.current = null;
    armResizeAutoFollowSkip();
    scrollTimelineItemIntoView(targetKey, {
      block: "start",
      behavior: "smooth",
      topOffsetPx: COLLAPSE_SCROLL_TOP_OFFSET_PX
    });
  }, [
    expandedCompactItemKeys,
    autoCollapsingItemKeys,
    armResizeAutoFollowSkip,
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
  }, [scrollSnapshot.latestItemKey]);

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
    <section className="rounded-[var(--app-radius-xl)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_96%,transparent)] shadow-none lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Active Session
          </div>
          <h2 className="mt-2 truncate font-mono text-sm font-medium text-[var(--app-text-primary)]">
            {currentSession?.sessionId ?? "当前会话"}
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void handleCopySessionId()}
            disabled={!currentSession?.sessionId}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.72rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copyButtonLabel}
          </button>
          {headerActions}
        </div>
      </header>

      <div className="px-4 pb-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 lg:min-h-0 lg:flex-1">
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
            <div ref={timelineContentRef} className="grid gap-3">
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
            <form onSubmit={onSubmit} className="relative grid gap-3">
              <div className="grid gap-3">
                <div className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex justify-center">
                  <SessionTodoPanel
                    todoState={currentSession?.context.todoState ?? null}
                    updating={todoUpdating}
                  />
                </div>

                {permissionCardView ? (
                  <div
                    key={permissionCardView.key}
                    className={`relative z-0 rounded-[var(--app-radius-lg)] border px-4 pb-4 pt-3 transition-all ${
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

                {userQuestionCardView ? (
                  <div
                    key={userQuestionCardView.key}
                    className="relative z-0 rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-status-warning)_56%,var(--app-border-subtle)_44%)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-surface)_88%)] px-4 pb-4 pt-3"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                          Need Clarification
                        </div>
                        <div className="mt-1 text-sm font-medium leading-6 text-[var(--app-text-primary)]">
                          {userQuestionCardView.questionText}
                        </div>
                        {userQuestionCardView.contextNote ? (
                          <div className="mt-1 text-xs text-[var(--app-text-muted)]">
                            {userQuestionCardView.contextNote}
                          </div>
                        ) : null}
                      </div>

                      {userQuestionCardView.options.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {userQuestionCardView.options.map((option) => (
                            <button
                              key={`${option.label}:${option.reply}`}
                              type="button"
                              title={option.description}
                              onClick={() =>
                                onUserQuestionQuickReply(option.reply)
                              }
                              disabled={submitting}
                              className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-warning)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="text-xs text-[var(--app-text-muted)]">
                        也可以直接在下面输入你的答案。
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="relative">
                  <textarea
                    value={message}
                    onChange={(event) => onMessageChange(event.target.value)}
                    rows={3}
                    placeholder="输入你的请求"
                    className="relative z-10 w-full resize-none rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-canvas)_14%,var(--app-bg-surface)_86%)] px-4 pb-14 pt-3 text-sm leading-7 text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                  />
                  <div
                    ref={quickActionsRef}
                    className="absolute bottom-3 left-3 z-20"
                  >
                    <div className="relative">
                      {quickActionsOpen ? (
                        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_98%,transparent)] p-3 shadow-none">
                          <div className="grid gap-3">
                            <label className="grid gap-2 text-sm text-[var(--app-text-secondary)]">
                              <span className="text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                                Model
                              </span>
                              <select
                                value={selectedModelId}
                                onChange={(event) => {
                                  onSettingsModelChange(event.target.value);
                                }}
                                disabled={!currentSession}
                                className="w-full rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[var(--app-bg-surface)] px-3 py-2.5 text-sm text-[var(--app-text-primary)] outline-none transition focus:border-[var(--app-border-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {modelCatalog.map((model) => (
                                  <option
                                    key={model.id}
                                    value={model.id}
                                    disabled={!model.configured}
                                  >
                                    {model.label}
                                    {model.configured ? "" : " (unavailable)"}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_92%,transparent)] px-3 py-2.5 text-sm text-[var(--app-text-secondary)]">
                              <div>
                                <div className="text-sm text-[var(--app-text-primary)]">
                                  Plan Mode
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={
                                  currentSession?.context.planModeEnabled ??
                                  false
                                }
                                onChange={(event) => {
                                  onSessionPlanModeChange(event.target.checked);
                                }}
                                disabled={!currentSession}
                                className="h-4 w-4 accent-[var(--app-border-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            </label>
                          </div>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        aria-label="打开会话快捷操作"
                        aria-expanded={quickActionsOpen}
                        disabled={!currentSession}
                        onClick={() =>
                          setQuickActionsOpen((current) => !current)
                        }
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-[1.35rem] leading-none text-[var(--app-text-secondary)] transition hover:bg-[color:color-mix(in_srgb,var(--app-bg-surface)_90%,transparent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

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
                    <span className="min-w-0 font-mono text-[var(--app-text-secondary)]">
                      cwd{" "}
                      {formatWorkingDirectory(
                        currentSession?.workingDirectory ?? "--"
                      )}
                    </span>
                    <span
                      className={`${
                        currentSession?.context.yoloMode
                          ? "text-[var(--app-status-success)]"
                          : "text-[var(--app-text-muted)]"
                      }`}
                    >
                      yolo {currentSession?.context.yoloMode ? "on" : "off"}
                    </span>
                    <span className="font-mono text-xs text-[var(--app-text-muted)]">
                      {currentSession
                        ? `peak ctx ${formatContextWindowUsage(
                            peakTurnContextTokens,
                            currentSession.contextWindow
                          )}`
                        : "peak ctx -- / ctx --"}
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
                  <div className="rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-status-danger)_35%,var(--app-border-subtle)_65%)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,var(--app-bg-surface)_90%)] px-4 py-3 text-sm text-[var(--app-status-danger)]">
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
