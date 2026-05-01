"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

import {
  type ModelCatalogEntry,
  type RunStreamEvent,
  type SessionSnapshot,
  type SessionWorkspaceGitStatus,
  type WorkspaceFileSearchResult,
  type WorkspaceSkillSearchResult,
  type WorkspaceFileChangeSummary
} from "@ai-app-template/sdk";

import {
  getNextComposerSuggestionIndex,
  getComposerSuggestionRefreshIndex,
  getActiveComposerCommandToken,
  replaceComposerCommandToken,
  type ComposerCommandTokenMatch
} from "./session-composer-commands";
import { MessageMarkdown } from "./message-markdown";
import { SessionTodoPanel } from "./session-todo-panel";
import {
  getAssistantTextRenderMode,
  getNextTypewriterLength,
  getTypewriterVisibleLengthOnChange,
  splitTypewriterCharacters
} from "./message-typewriter";
import {
  type CompactCollapsedFlowViewItem,
  type CompactFileBatchViewItem,
  type CompactToolViewItem,
  type ConversationViewItem
} from "./session-conversation-view";
import type { ConversationProjection } from "./session-message-manager";
import {
  DiffCollapseButton,
  getCompactToolFileChangeRows,
  getWorkspaceFileChangeRows,
  UnifiedDiffBlock
} from "./session-workbench-diff";
import {
  buildBackgroundNotificationCopy,
  buildComposerActionView,
  buildComposerFileSuggestionItems,
  buildComposerSkillSuggestionItems,
  buildComposerSlashSuggestionItems,
  buildConfirmationCardView,
  buildPermissionCardView,
  buildPermissionQuickReplies,
  buildUserQuestionCardView,
  buildUserQuestionReplyMessage,
  createPermissionCardFeedback,
  getBackgroundNotificationCardLabel,
  getBackgroundNotificationKindLabel,
  getBackgroundNotificationHeadline,
  getComposerEnterKeyIntent,
  getComposerSuggestionsEmptyState,
  getPermissionRequestKey,
  type ComposerSuggestionItem,
  type ComposerSuggestionsState,
  type PermissionCardFeedback
} from "./session-workbench-conversation-helpers";
import {
  buildConversationScrollSnapshot,
  getConversationScrollIntent,
  getConversationResizeAutoFollowIntent,
  updateConversationAutoFollowState,
  type ConversationScrollSnapshot
} from "./session-workbench-scroll";
import {
  getTimelineEventKey,
  type TimelineItem,
  type TimelinePendingHookRun,
  type TimelineUserHookMetadata
} from "./session-timeline";
import type { TurnUsageSummary } from "./session-workbench-types";
import {
  formatCacheUsage,
  formatContextWindowUsage,
  formatTimestamp,
  formatTokenCount,
  formatWorkingDirectory,
  getPeakTurnContextTokens,
  CopyTextButton,
  getBubbleClass,
  getDebugPreClass,
  getInspectorCardClass,
  getSoftBlockClass,
  stringify,
  WorkbenchSelect,
  WorkbenchSwitch
} from "./session-workbench-shared";
export {
  buildBackgroundNotificationCopy,
  buildComposerActionView,
  buildConfirmationCardView,
  buildPermissionCardView,
  buildPermissionQuickReplies,
  buildUserQuestionCardView,
  buildUserQuestionReplyMessage,
  createPermissionCardFeedback,
  getBackgroundNotificationCardLabel,
  getBackgroundNotificationHeadline,
  getComposerEnterKeyIntent,
  getConfirmationKey,
  getPermissionRequestKey,
  getUserQuestionKey
} from "./session-workbench-conversation-helpers";
export {
  getCompactToolFileChangeRows,
  getUnifiedDiffLineTone,
  getWorkspaceFileChangeRows
} from "./session-workbench-diff";

interface SessionWorkbenchConversationPanelProps {
  currentSession: SessionSnapshot | null;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  selectedThinkingEffort: string;
  todoUpdating: boolean;
  loading: boolean;
  conversationProjection: ConversationProjection;
  turnUsageByTurnCount: Map<number, TurnUsageSummary>;
  expandedItemKeys: Set<string>;
  autoCollapsingItemKeys: Set<string>;
  debugConversationView: boolean;
  pendingPermissionRequest: SessionSnapshot["context"]["pendingPermissionRequest"];
  pendingConfirmationPayload: SessionSnapshot["context"]["pendingConfirmationPayload"];
  pendingUserQuestionPayload: SessionSnapshot["context"]["pendingUserQuestionPayload"];
  workspaceGitStatus: SessionWorkspaceGitStatus | null;
  workspaceGitStatusLoading: boolean;
  message: string;
  submitting: boolean;
  canInterrupt: boolean;
  interrupting: boolean;
  showInterruptedHint: boolean;
  errorText: string | null;
  runFileChanges: RunFileChangesView[];
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInterrupt: () => void;
  onSettingsModelChange: (model: string) => void;
  onSettingsThinkingEffortChange: (thinkingEffort: string) => void;
  onSettingsYoloModeChange: (checked: boolean) => void;
  onSessionPlanModeChange: (checked: boolean) => void;
  onEnablePlanModeCommand: () => Promise<boolean>;
  onSearchWorkspaceFiles: (
    query: string,
    limit: number
  ) => Promise<WorkspaceFileSearchResult>;
  onSearchWorkspaceSkills: (
    query: string,
    limit: number
  ) => Promise<WorkspaceSkillSearchResult>;
  onPermissionQuickReply: (
    reply: string,
    options?: { persistShellApproval?: boolean }
  ) => void | Promise<void>;
  onConfirmationQuickReply: (reply: string) => void;
  onUserQuestionQuickReply: (reply: string) => void;
  onRunFileChangeAction: (viewKey: string, action: "undo" | "reapply") => void;
  onRunFileSelectionChange: (
    viewKey: string,
    selectedFileIndexes: number[]
  ) => void;
  onAssistantAnimationComplete: (itemKey: string) => void;
  onToggleExpandedItem: (key: string) => void;
  onAutoCollapseComplete: (key: string) => void;
  headerActions?: ReactNode;
}

export interface RunFileChangesView {
  key: string;
  createdAt: string;
  files: WorkspaceFileChangeSummary[];
  fileStates: Array<"applied" | "undone">;
  state: "applied" | "undone" | "mixed";
  selectedFileIndexes: number[];
  pendingAction: "undo" | "reapply" | null;
  errorText: string | null;
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

type MessageRole = "user" | "assistant" | "hook";

interface ComposerSelectionRange {
  start: number;
  end: number;
}

const COMPOSER_SUGGESTION_LIMIT = 8;
const COMPOSER_SUGGESTION_DEBOUNCE_MS = 120;

function MessageRoleLabel({
  role,
  timestamp
}: {
  role: MessageRole;
  timestamp?: string | undefined;
}) {
  const roleLabel =
    role === "user" ? "USER" : role === "hook" ? "HOOK" : "ASSISTANT";

  return (
    <div className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
      <span>{roleLabel}</span>
      {timestamp ? (
        <span className="tracking-[0.08em]">{formatTimestamp(timestamp)}</span>
      ) : null}
    </div>
  );
}

const PERMISSION_FEEDBACK_HIDE_DELAY_MS = 200;
const AUTO_COLLAPSE_ANIMATION_MS = 240;
const COLLAPSE_SCROLL_TOP_OFFSET_PX = 20;
const SMOOTH_SCROLL_DURATION_MS = 320;

interface SessionGitStatusSummaryView {
  badgeLabel: string;
  branchLabel: string | null;
  tone: "neutral" | "success" | "warning" | "danger";
  title: string;
}

function formatSessionGitBranchLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const firstSegment = trimmed.split(" ")[0] ?? trimmed;
  return (firstSegment.split("...")[0] ?? trimmed).trim() || trimmed;
}

function getSessionGitStatusBadgeClass(
  tone: SessionGitStatusSummaryView["tone"]
): string {
  switch (tone) {
    case "success":
      return "border-[color:color-mix(in_srgb,var(--app-status-success)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--app-status-success)_11%,var(--app-bg-muted)_89%)] text-[var(--app-status-success)]";
    case "warning":
      return "border-[color:color-mix(in_srgb,var(--app-status-warning)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_11%,var(--app-bg-muted)_89%)] text-[var(--app-status-warning)]";
    case "danger":
      return "border-[color:color-mix(in_srgb,var(--app-status-danger)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_11%,var(--app-bg-muted)_89%)] text-[var(--app-status-danger)]";
    default:
      return "border-[color:color-mix(in_srgb,var(--app-border-subtle)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_68%,transparent)] text-[var(--app-text-secondary)]";
  }
}

export function buildSessionGitStatusSummary(
  status: SessionWorkspaceGitStatus | null
): SessionGitStatusSummaryView | null {
  if (!status) {
    return null;
  }

  const branchLabel = formatSessionGitBranchLabel(status.branch);

  if (!status.ok) {
    if (status.code === "NOT_GIT_REPOSITORY") {
      return {
        badgeLabel: "git none",
        branchLabel: null,
        tone: "neutral",
        title: status.message
      };
    }

    return {
      badgeLabel: "git error",
      branchLabel: null,
      tone: "danger",
      title: status.message
    };
  }

  if (status.clean) {
    return {
      badgeLabel: "git clean",
      branchLabel,
      tone: "success",
      title: [status.branch, "0 changed"].filter(Boolean).join(" | ")
    };
  }

  const countDetails = [
    `${status.changedPathCount} changed`,
    `+${status.addedLineCount} added`,
    `-${status.removedLineCount} removed`,
    `${status.stagedPathCount} staged`,
    `${status.unstagedPathCount} unstaged`,
    `${status.untrackedPathCount} untracked`
  ];

  return {
    badgeLabel: `git ${status.changedPathCount} +${status.addedLineCount}/-${status.removedLineCount}`,
    branchLabel,
    tone: "warning",
    title: [status.branch, countDetails.join(" | ")].filter(Boolean).join(" | ")
  };
}

export function SessionGitStatusHeaderChips({
  workspaceGitStatus,
  loading
}: {
  workspaceGitStatus: SessionWorkspaceGitStatus | null;
  loading: boolean;
}) {
  const summary = buildSessionGitStatusSummary(workspaceGitStatus);

  if (!summary && !loading) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {summary ? (
        <span
          title={summary.title}
          className={`inline-flex items-center rounded-[var(--app-radius-pill)] border px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] ${getSessionGitStatusBadgeClass(summary.tone)}`}
        >
          {summary.badgeLabel}
        </span>
      ) : null}
      {summary?.branchLabel ? (
        <span
          title={workspaceGitStatus?.branch ?? undefined}
          className="inline-flex items-center rounded-[var(--app-radius-pill)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_68%,transparent)] px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-[var(--app-text-secondary)]"
        >
          {summary.branchLabel}
        </span>
      ) : null}
      {loading && !summary ? (
        <span className="inline-flex items-center rounded-[var(--app-radius-pill)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_68%,transparent)] px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-[var(--app-text-muted)]">
          git ...
        </span>
      ) : null}
    </div>
  );
}

function escapeTimelineItemKey(key: string): string {
  return key.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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

function getHookEventLabel(event: TimelineUserHookMetadata["event"]): string {
  if (event === "session_started") {
    return "SESSION START";
  }

  if (event === "run_started") {
    return "RUN START";
  }

  return "RUN END";
}

function renderHookMessageBlock(
  block: Extract<SessionSnapshot["messages"][number], { kind: "user" }>,
  metadata: TimelineUserHookMetadata
) {
  return (
    <div key={block.id} className="flex flex-col items-end gap-1">
      <MessageRoleLabel role="hook" timestamp={block.createdAt} />
      <div className="ml-auto max-w-[88%] rounded-[var(--app-radius-md)] rounded-br-sm border border-[color:color-mix(in_srgb,var(--app-border-accent)_68%,var(--app-border-subtle)_32%)] bg-[color:color-mix(in_srgb,var(--app-border-accent)_10%,var(--app-bg-elevated)_90%)] px-4 py-3 text-sm leading-7 text-[var(--app-text-primary)]">
        <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
          <span className="text-[var(--app-status-success)]">
            {getHookEventLabel(metadata.event)}
          </span>
          {metadata.title ? (
            <span className="min-w-0 truncate tracking-[0.08em]">
              {metadata.title}
            </span>
          ) : null}
        </div>
        <div>{block.content}</div>
      </div>
    </div>
  );
}

function renderPendingHookRun(
  hookRun: TimelinePendingHookRun,
  createdAt: string
) {
  return (
    <div
      key={`pending-hook-${createdAt}`}
      className="flex flex-col items-end gap-1"
    >
      <MessageRoleLabel role="hook" timestamp={createdAt} />
      <div className="ml-auto flex max-w-[88%] flex-col gap-2 rounded-[var(--app-radius-md)] rounded-br-sm border border-[color:color-mix(in_srgb,var(--app-border-accent)_68%,var(--app-border-subtle)_32%)] bg-[color:color-mix(in_srgb,var(--app-border-accent)_10%,var(--app-bg-elevated)_90%)] px-4 py-3 text-sm leading-7 text-[var(--app-text-primary)]">
        <div className="flex items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
          <span className="text-[var(--app-status-success)]">HOOK ACTIVE</span>
          <span className="tracking-[0.08em]">生效中</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {hookRun.hooks.map((hook, index) => (
            <span
              key={`${hook.event}-${hook.title || index}`}
              className="rounded-full border border-[color:color-mix(in_srgb,var(--app-border-subtle)_70%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_40%,transparent)] px-2.5 py-1 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--app-text-secondary)]"
            >
              {getHookEventLabel(hook.event)}
              {hook.title ? ` · ${hook.title}` : ""}
            </span>
          ))}
        </div>
      </div>
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
  const totalLength = useMemo(
    () => splitTypewriterCharacters(content).length,
    [content]
  );
  const hasVisibleContent = content.trim().length > 0;
  const previousItemKeyRef = useRef(itemKey);
  const previousAnimateRef = useRef(animate);
  const previousTotalLengthRef = useRef(totalLength);
  const [visibleLength, setVisibleLength] = useState(() =>
    animate ? 0 : totalLength
  );

  useEffect(() => {
    setVisibleLength((currentVisibleLength) =>
      getTypewriterVisibleLengthOnChange({
        animate,
        itemChanged: previousItemKeyRef.current !== itemKey,
        animationStarted: animate && !previousAnimateRef.current,
        totalLength,
        previousTotalLength: previousTotalLengthRef.current,
        currentVisibleLength
      })
    );
    previousItemKeyRef.current = itemKey;
    previousAnimateRef.current = animate;
    previousTotalLengthRef.current = totalLength;
  }, [animate, itemKey, totalLength]);

  useEffect(() => {
    if (!animate || visibleLength >= totalLength) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      setVisibleLength((currentVisibleLength) =>
        getNextTypewriterLength(currentVisibleLength, totalLength)
      );
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [animate, totalLength, visibleLength]);

  useEffect(() => {
    if (!animate || streaming || visibleLength < totalLength) {
      return;
    }

    onAnimationComplete?.(itemKey);
  }, [
    animate,
    itemKey,
    onAnimationComplete,
    streaming,
    totalLength,
    visibleLength
  ]);

  const renderMode = getAssistantTextRenderMode({
    animate,
    streaming,
    totalLength,
    visibleLength
  });
  const showPlainText =
    !renderMarkdownWhenSettled || renderMode === "plaintext";
  const visibleContent = content;

  if (!hasVisibleContent) {
    return null;
  }

  return (
    <div className={className}>
      {showPlainText ? (
        <div className="min-w-0 whitespace-pre-wrap text-sm leading-7 text-inherit [overflow-wrap:anywhere]">
          {visibleContent}
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
          streaming ? "[overflow-anchor:none]" : ""
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
  timestampedAssistantMessageIds: Set<string>,
  userHook?: TimelineUserHookMetadata
) {
  if (block.kind === "user") {
    if (userHook) {
      return renderHookMessageBlock(block, userHook);
    }

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

  if (
    event.kind === "background_notification" ||
    event.kind === "background_notification_consumed"
  ) {
    const isConsumed = event.kind === "background_notification_consumed";
    const { summaryText, contentText } = buildBackgroundNotificationCopy(
      event.notification
    );
    const childSessionId = event.notification.childSessionId ?? null;
    const consumedIdLabel = childSessionId ? "Session ID" : "Task ID";
    const toneClass = isConsumed
      ? "text-[var(--app-text-muted)]"
      : event.notification.kind === "task_failed" ||
          event.notification.kind === "task_timeout"
        ? "text-[var(--app-status-danger)]"
        : event.notification.kind === "task_waiting"
          ? "text-[var(--app-status-warning)]"
          : "text-[var(--app-text-secondary)]";
    const title = getBackgroundNotificationCardLabel({
      taskKind: event.notification.taskKind,
      isConsumed
    });
    const cardClass = getInspectorCardClass(
      isConsumed
        ? "border-[color:color-mix(in_srgb,var(--app-text-muted)_18%,var(--app-border-subtle)_82%)] bg-[color:color-mix(in_srgb,var(--app-bg-elevated)_54%,var(--app-bg-surface)_46%)]"
        : ""
    );

    return (
      <article key={getTimelineEventKey(event)} className={cardClass}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              {title}
            </div>
            <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
              {getBackgroundNotificationHeadline({
                kind: event.notification.kind,
                title: event.notification.title,
                taskKind: event.notification.taskKind,
                isConsumed
              })}
            </div>
          </div>
          <div
            className={`shrink-0 rounded-full px-2 py-1 text-[0.72rem] ${
              isConsumed
                ? "bg-[color:color-mix(in_srgb,var(--app-bg-muted)_76%,transparent)] text-[var(--app-text-secondary)]"
                : toneClass
            }`}
          >
            {isConsumed
              ? "已处理"
              : `${getBackgroundNotificationKindLabel(
                  event.notification.kind
                )} · ${event.notification.taskKind}`}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-[var(--app-text-secondary)]">
          {isConsumed ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--app-radius-sm)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_70%,transparent)] px-3 py-2 text-xs text-[var(--app-text-secondary)]">
              <span className="font-mono uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                {consumedIdLabel}
              </span>
              <span className="min-w-0 break-all font-mono text-[var(--app-text-primary)]">
                {childSessionId ?? event.notification.taskId}
              </span>
            </div>
          ) : summaryText ? (
            <div>{summaryText}</div>
          ) : null}
          {!isConsumed && contentText ? (
            <div className="text-[var(--app-text-muted)]">{contentText}</div>
          ) : null}
          {event.notification.requiresMainAgentReply ? (
            <div className="text-[var(--app-status-warning)]">
              需要主代理继续处理
            </div>
          ) : null}
        </div>
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
          <div className="flex items-center gap-2">
            <CopyTextButton
              text={event.error}
              label="复制"
              copiedLabel="已复制"
              failedLabel="复制失败"
              title="复制报错"
              ariaLabel="复制报错"
            />
            <div className="text-[0.72rem] text-[var(--app-text-muted)]">
              {formatTimestamp(event.createdAt)}
            </div>
          </div>
        </div>
        <div className="mt-3 whitespace-pre-wrap break-words">
          {event.error}
        </div>
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

  if (item.type === "pending-hook") {
    return renderPendingHookRun(item.hookRun, item.createdAt);
  }

  return renderConversationBlock(
    item.block,
    timestampedAssistantMessageIds,
    item.userHook
  );
}

function renderCompactToolItem(
  item: CompactToolViewItem,
  expanded: boolean,
  onToggleExpanded: (key: string) => void,
  renderNestedItems: (items: ConversationViewItem[]) => React.ReactNode
) {
  const fileChangeRows = getCompactToolFileChangeRows(item);
  const taskBriefPreview = item.taskBriefPreview;

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
          ) : taskBriefPreview ? (
            <div className="mt-3">
              <div className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                Task Brief
              </div>
              <div className="mt-1 text-xs text-[var(--app-text-muted)] [overflow-wrap:anywhere]">
                {taskBriefPreview.path}
              </div>
              <MessageMarkdown
                content={taskBriefPreview.content}
                className="mt-3 text-[var(--app-text-secondary)]"
              />
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
                  <UnifiedDiffBlock diff={file.diff} />
                </section>
              ))}
              <DiffCollapseButton onClick={() => onToggleExpanded(item.key)} />
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

function getRunFileChangeTotals(files: WorkspaceFileChangeSummary[]): {
  addedLineCount: number;
  removedLineCount: number;
} {
  return files.reduce(
    (totals, file) => ({
      addedLineCount: totals.addedLineCount + file.addedLineCount,
      removedLineCount: totals.removedLineCount + file.removedLineCount
    }),
    { addedLineCount: 0, removedLineCount: 0 }
  );
}

function renderRunFileChangesPanel(input: {
  view: RunFileChangesView;
  expandedFileKeys: Set<string>;
  onToggleFile: (key: string) => void;
  onSelectionChange: (selectedFileIndexes: number[]) => void;
  onAction: (action: "undo" | "reapply") => void;
}) {
  const { view, expandedFileKeys, onToggleFile, onSelectionChange, onAction } =
    input;
  const rows = getWorkspaceFileChangeRows(view.files);
  const totals = getRunFileChangeTotals(view.files);
  const isBusy = view.pendingAction !== null;
  const selectedIndexes = view.selectedFileIndexes.filter(
    (index) => index >= 0 && index < view.files.length
  );
  const selectedIndexSet = new Set(selectedIndexes);
  const selectedStates = selectedIndexes.map(
    (index) => view.fileStates[index] ?? "applied"
  );
  const selectedCount = selectedIndexes.length;
  const canUndo =
    selectedCount > 0 &&
    selectedStates.every((state) => state === "applied") &&
    !isBusy;
  const canReapply =
    selectedCount > 0 &&
    selectedStates.every((state) => state === "undone") &&
    !isBusy;
  const allSelected = selectedCount === view.files.length;

  return (
    <article className="rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,var(--app-bg-surface)_22%)] px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm font-medium text-[var(--app-text-primary)]">
            <span>{view.files.length} 个文件已更改</span>
            <span className="font-mono text-[var(--app-status-success)]">
              +{totals.addedLineCount}
            </span>
            <span className="font-mono text-[var(--app-status-danger)]">
              -{totals.removedLineCount}
            </span>
          </div>
          {view.state === "undone" ? (
            <div className="mt-1 text-xs text-[var(--app-text-muted)]">
              已撤销，可重新应用。
            </div>
          ) : view.state === "mixed" ? (
            <div className="mt-1 text-xs text-[var(--app-text-muted)]">
              部分文件已撤销。
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[0.72rem] text-[var(--app-text-muted)]">
            已选 {selectedCount}
          </span>
          <button
            type="button"
            onClick={() =>
              onSelectionChange(
                allSelected ? [] : view.files.map((_, index) => index)
              )
            }
            disabled={isBusy}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {allSelected ? "清空" : "全选"}
          </button>
          <button
            type="button"
            onClick={() => onAction("undo")}
            disabled={!canUndo}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-warning)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {view.pendingAction === "undo" ? "撤销中..." : "撤销"}
          </button>
          <button
            type="button"
            onClick={() => onAction("reapply")}
            disabled={!canReapply}
            className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {view.pendingAction === "reapply" ? "应用中..." : "重新应用"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid divide-y divide-[color:color-mix(in_srgb,var(--app-border-subtle)_55%,transparent)]">
        {rows.map((file, index) => {
          const originalFile = view.files[index]!;
          const fileKey = `${view.key}:${file.path}`;
          const expanded = expandedFileKeys.has(fileKey);
          const checked = selectedIndexSet.has(index);
          const fileState = view.fileStates[index] ?? "applied";
          return (
            <section
              key={fileKey}
              className="min-w-0 py-2 first:pt-0 last:pb-0"
            >
              <div className="flex w-full min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isBusy}
                  onChange={(event) => {
                    const next = new Set(selectedIndexes);
                    if (event.currentTarget.checked) {
                      next.add(index);
                    } else {
                      next.delete(index);
                    }
                    onSelectionChange(
                      [...next].sort((left, right) => left - right)
                    );
                  }}
                  className="h-4 w-4 shrink-0 accent-[var(--app-border-accent)]"
                  aria-label={`选择 ${file.path}`}
                />
                <button
                  type="button"
                  onClick={() => onToggleFile(fileKey)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1 text-sm text-[var(--app-text-secondary)] [overflow-wrap:anywhere]">
                    {file.path}
                  </span>
                  <span className="shrink-0 font-mono text-sm text-[var(--app-status-success)]">
                    +{originalFile.addedLineCount}
                  </span>
                  <span className="shrink-0 font-mono text-sm text-[var(--app-status-danger)]">
                    -{originalFile.removedLineCount}
                  </span>
                  <span className="shrink-0 font-mono text-[0.68rem] uppercase text-[var(--app-text-muted)]">
                    {fileState === "undone" ? "undone" : "applied"}
                  </span>
                  <span className="shrink-0 text-[0.72rem] text-[var(--app-text-muted)]">
                    {expanded ? "收起" : "展开"}
                  </span>
                </button>
              </div>
              <div
                aria-hidden={!expanded}
                className={`grid transition-[grid-template-rows,opacity,margin-top] duration-200 ease-[var(--app-ease-standard)] ${
                  expanded
                    ? "mt-2 grid-rows-[1fr] opacity-100"
                    : "mt-0 grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <UnifiedDiffBlock diff={file.diff} />
                  <DiffCollapseButton
                    onClick={() => onToggleFile(fileKey)}
                    ariaLabel={`收起 ${file.path} 的 diff`}
                  />
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {view.errorText ? (
        <div className="mt-3 rounded-[var(--app-radius-md)] border border-[color:color-mix(in_srgb,var(--app-status-danger)_35%,var(--app-border-subtle)_65%)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_10%,var(--app-bg-surface)_90%)] px-3 py-2 text-sm text-[var(--app-status-danger)]">
          {view.errorText}
        </div>
      ) : null}
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

function hasRenderableTimelineContent(node: React.ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

type ConversationRenderEntry =
  | {
      type: "conversation";
      key: string;
      item: ConversationProjection["visibleItems"][number];
    }
  | {
      type: "run-file-changes";
      key: string;
      view: RunFileChangesView;
    };

function buildConversationRenderEntries(input: {
  items: ConversationProjection["visibleItems"];
  runFileChanges: RunFileChangesView[];
}): ConversationRenderEntry[] {
  const sortedRunFileChanges = [...input.runFileChanges].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.key.localeCompare(right.key)
      : left.createdAt.localeCompare(right.createdAt)
  );
  const entries: ConversationRenderEntry[] = [];
  let viewIndex = 0;

  for (let itemIndex = 0; itemIndex < input.items.length; itemIndex += 1) {
    const item = input.items[itemIndex]!;
    const nextItem = input.items[itemIndex + 1];
    entries.push({
      type: "conversation",
      key: item.key,
      item
    });

    while (
      viewIndex < sortedRunFileChanges.length &&
      (!nextItem ||
        sortedRunFileChanges[viewIndex]!.createdAt < nextItem.createdAt)
    ) {
      const view = sortedRunFileChanges[viewIndex]!;
      entries.push({
        type: "run-file-changes",
        key: view.key,
        view
      });
      viewIndex += 1;
    }
  }

  while (viewIndex < sortedRunFileChanges.length) {
    const view = sortedRunFileChanges[viewIndex]!;
    entries.push({
      type: "run-file-changes",
      key: view.key,
      view
    });
    viewIndex += 1;
  }

  return entries;
}

export function SessionWorkbenchConversationPanel({
  currentSession,
  modelCatalog,
  selectedModelId,
  selectedThinkingEffort,
  todoUpdating,
  loading,
  conversationProjection,
  turnUsageByTurnCount,
  expandedItemKeys,
  autoCollapsingItemKeys,
  debugConversationView,
  pendingPermissionRequest,
  pendingConfirmationPayload,
  pendingUserQuestionPayload,
  workspaceGitStatus,
  workspaceGitStatusLoading,
  message,
  submitting,
  canInterrupt,
  interrupting,
  showInterruptedHint,
  errorText,
  runFileChanges,
  onMessageChange,
  onSubmit,
  onInterrupt,
  onSettingsModelChange,
  onSettingsThinkingEffortChange,
  onSettingsYoloModeChange,
  onSessionPlanModeChange,
  onEnablePlanModeCommand,
  onSearchWorkspaceFiles,
  onSearchWorkspaceSkills,
  onPermissionQuickReply,
  onConfirmationQuickReply,
  onUserQuestionQuickReply,
  onRunFileChangeAction,
  onRunFileSelectionChange,
  onAssistantAnimationComplete,
  onToggleExpandedItem,
  onAutoCollapseComplete,
  headerActions
}: SessionWorkbenchConversationPanelProps) {
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [commandActionPending, setCommandActionPending] = useState(false);
  const [composerActiveIndex, setComposerActiveIndex] = useState(0);
  const [composerSelection, setComposerSelection] =
    useState<ComposerSelectionRange>({
      start: message.length,
      end: message.length
    });
  const [composerSuggestions, setComposerSuggestions] =
    useState<ComposerSuggestionsState | null>(null);
  const composerActiveIndexRef = useRef(0);
  const composerSuggestionsRef = useRef<ComposerSuggestionsState | null>(null);
  const [permissionCardFeedback, setPermissionCardFeedback] =
    useState<PermissionCardFeedback | null>(null);
  const [persistShellApproval, setPersistShellApproval] = useState(false);
  const persistShellApprovalRef = useRef(false);
  const [activeUserQuestionIndex, setActiveUserQuestionIndex] = useState(0);
  const [userQuestionReplies, setUserQuestionReplies] = useState<string[]>([]);
  const [expandedRunFileKeys, setExpandedRunFileKeys] = useState<Set<string>>(
    () => new Set()
  );
  const pendingCollapsedFlowScrollTargetRef = useRef<string | null>(null);
  const pendingAssistantRevealSkipKeyRef = useRef<string | null>(null);
  const composerContainerRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionRequestVersionRef = useRef(0);
  const quickActionsRef = useRef<HTMLDivElement | null>(null);
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const previousScrollSnapshotRef = useRef<ConversationScrollSnapshot | null>(
    null
  );
  const pendingSessionEntryBottomScrollRef = useRef(false);
  const autoFollowLatestRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const previousViewportScrollTopRef = useRef(0);
  const skipNextResizeAutoFollowRef = useRef(false);
  const resizeAutoFollowResetFrameRef = useRef<number | null>(null);
  const smoothScrollResetTimeoutRef = useRef<number | null>(null);
  const permissionRequestKey = getPermissionRequestKey(
    pendingPermissionRequest
  );
  const isShellPermissionRequest =
    pendingPermissionRequest?.toolName === "run_shell_command";
  const confirmationCardView = buildConfirmationCardView(
    pendingConfirmationPayload
  );
  const userQuestionCardView = buildUserQuestionCardView(
    pendingUserQuestionPayload
  );
  const activeUserQuestion =
    userQuestionCardView?.questions[activeUserQuestionIndex] ?? null;
  const userQuestionReplyDraft = activeUserQuestion
    ? (userQuestionReplies[activeUserQuestionIndex] ?? "")
    : "";
  const userQuestionReplyMessage = buildUserQuestionReplyMessage({
    payload: pendingUserQuestionPayload,
    replies: userQuestionReplies
  });
  const activeComposerToken = useMemo(
    () =>
      getActiveComposerCommandToken({
        value: message,
        selectionStart: composerSelection.start,
        selectionEnd: composerSelection.end
      }),
    [message, composerSelection]
  );
  const visibleConversationViewItems = conversationProjection.visibleItems;
  const collapsedFlowAnchorsByKey =
    conversationProjection.collapsedFlowAnchorsByKey;
  const conversationRenderEntries = useMemo(
    () =>
      buildConversationRenderEntries({
        items: visibleConversationViewItems,
        runFileChanges
      }),
    [visibleConversationViewItems, runFileChanges]
  );
  const scrollItems = useMemo(() => {
    return conversationRenderEntries.map((entry) => {
      if (entry.type === "run-file-changes") {
        return {
          key: entry.key,
          type: "run-file-changes"
        };
      }

      const item = entry.item;
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
    }) satisfies Array<{
      key: string;
      type: string;
      event?: RunStreamEvent;
    }>;
  }, [conversationRenderEntries]);
  const scrollSnapshot = useMemo(
    () => buildConversationScrollSnapshot(scrollItems),
    [scrollItems]
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
  const currentWorkingDirectory = currentSession?.workingDirectory ?? "--";
  const currentSessionId = currentSession?.sessionId ?? null;
  const currentWorkingDirectoryLabel = formatWorkingDirectory(
    currentWorkingDirectory
  );
  const yoloModeEnabled = currentSession?.context.yoloMode ?? false;
  const selectedModel = modelCatalog.find(
    (model) => model.id === selectedModelId
  );
  const thinkingEffortOptions = selectedModel?.thinkingEfforts ?? [];
  const peakContextUsageLabel = currentSession
    ? formatContextWindowUsage(
        peakTurnContextTokens,
        currentSession.contextWindow
      )
    : "-- / ctx --";

  useEffect(() => {
    if (!userQuestionCardView) {
      setActiveUserQuestionIndex(0);
      setUserQuestionReplies([]);
      return;
    }

    setActiveUserQuestionIndex(0);
    setUserQuestionReplies(
      Array.from({ length: userQuestionCardView.questions.length }, () => "")
    );
  }, [userQuestionCardView?.key]);

  useEffect(() => {
    if (!userQuestionCardView) {
      return;
    }

    setActiveUserQuestionIndex((current) =>
      Math.min(current, Math.max(0, userQuestionCardView.questions.length - 1))
    );
  }, [userQuestionCardView?.questions.length]);

  function setUserQuestionReply(index: number, value: string) {
    setUserQuestionReplies((current) => {
      const next = Array.from(
        { length: userQuestionCardView?.questions.length ?? 0 },
        (_, replyIndex) => current[replyIndex] ?? ""
      );
      next[index] = value;
      return next;
    });
  }

  const renderedTimelineItems = useMemo(
    () =>
      visibleConversationViewItems
        .map((item) => ({
          item,
          content: renderConversationViewItem(item, {
            streamEventKeys: conversationProjection.streamEventKeys,
            recentAssistantEventKeys:
              conversationProjection.recentAssistantEventKeys,
            timestampedAssistantEventKeys:
              conversationProjection.timestampedAssistantEventKeys,
            timestampedAssistantMessageIds:
              conversationProjection.timestampedAssistantMessageIds,
            autoCollapseKeys: autoCollapsingItemKeys,
            onAssistantAnimationComplete,
            turnUsageByTurnCount,
            expandedKeys: expandedItemKeys,
            onToggleExpanded: (key) => {
              if (expandedItemKeys.has(key)) {
                const scrollTargetKey =
                  collapsedFlowAnchorsByKey.get(key)?.scrollTargetKey ?? null;
                if (scrollTargetKey) {
                  pendingCollapsedFlowScrollTargetRef.current = scrollTargetKey;
                }
              }
              onToggleExpandedItem(key);
            },
            onAutoCollapseComplete: (key) => {
              const assistantItemKey =
                collapsedFlowAnchorsByKey.get(key)?.assistantItemKey ?? null;
              if (assistantItemKey) {
                pendingAssistantRevealSkipKeyRef.current = assistantItemKey;
              }
              onAutoCollapseComplete(key);
            }
          })
        }))
        .filter((entry) => hasRenderableTimelineContent(entry.content)),
    [
      visibleConversationViewItems,
      conversationProjection,
      autoCollapsingItemKeys,
      onAssistantAnimationComplete,
      turnUsageByTurnCount,
      expandedItemKeys,
      collapsedFlowAnchorsByKey,
      onToggleExpandedItem,
      onAutoCollapseComplete
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

  const scrollConversationViewportToBottom = useEffectEvent(() => {
    const viewport = conversationViewportRef.current;
    if (!viewport) {
      return;
    }

    const nextScrollTop = Math.max(
      0,
      viewport.scrollHeight - viewport.clientHeight
    );

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
  });

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

  function syncComposerSelection(target: HTMLTextAreaElement) {
    setComposerSelection({
      start: target.selectionStart,
      end: target.selectionEnd
    });
  }

  function applyComposerReplacement(
    token: ComposerCommandTokenMatch,
    replacement: string
  ) {
    const next = replaceComposerCommandToken({
      value: message,
      token,
      replacement
    });
    onMessageChange(next.value);
    setComposerSelection({
      start: next.nextSelection,
      end: next.nextSelection
    });
    setComposerSuggestions(null);
    setComposerActiveIndex(0);
    suggestionRequestVersionRef.current += 1;
    window.requestAnimationFrame(() => {
      const textarea = composerTextareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(next.nextSelection, next.nextSelection);
    });
  }

  async function handleComposerSuggestionSelect(item: ComposerSuggestionItem) {
    const token = activeComposerToken;
    if (!token || commandActionPending) {
      return;
    }

    if (item.kind === "slash" && item.command === "plan") {
      if (currentSession?.context.planModeEnabled) {
        applyComposerReplacement(token, "");
        return;
      }

      setCommandActionPending(true);
      const enabled = await enablePlanModeCommandEvent();
      setCommandActionPending(false);
      if (enabled) {
        applyComposerReplacement(token, "");
      }
      return;
    }

    applyComposerReplacement(token, item.replacement);
  }

  function handleComposerMessageChange(target: HTMLTextAreaElement) {
    onMessageChange(target.value);
    syncComposerSelection(target);
  }

  function handleComposerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ) {
    const enterIntent = getComposerEnterKeyIntent({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      commandMenuOpen: Boolean(composerSuggestions)
    });

    if (enterIntent === "select-command") {
      event.preventDefault();
      if (composerSuggestions?.items.length) {
        void handleComposerSuggestionSelect(
          composerSuggestions.items[composerActiveIndex] ??
            composerSuggestions.items[0]!
        );
      }
      return;
    }

    if (enterIntent === "submit") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }

    if (enterIntent === "newline") {
      return;
    }

    if (!composerSuggestions) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (composerSuggestions.items.length === 0) {
        return;
      }
      setComposerActiveIndex((current) =>
        getNextComposerSuggestionIndex({
          currentIndex: current,
          itemCount: composerSuggestions.items.length,
          direction: "down"
        })
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (composerSuggestions.items.length === 0) {
        return;
      }
      setComposerActiveIndex((current) =>
        getNextComposerSuggestionIndex({
          currentIndex: current,
          itemCount: composerSuggestions.items.length,
          direction: "up"
        })
      );
      return;
    }

    if (event.key === "Tab" && composerSuggestions.items.length > 0) {
      event.preventDefault();
      void handleComposerSuggestionSelect(
        composerSuggestions.items[composerActiveIndex] ??
          composerSuggestions.items[0]!
      );
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setComposerSuggestions(null);
      setComposerActiveIndex(0);
      suggestionRequestVersionRef.current += 1;
    }
  }

  const searchWorkspaceFilesEvent = useEffectEvent(onSearchWorkspaceFiles);
  const searchWorkspaceSkillsEvent = useEffectEvent(onSearchWorkspaceSkills);
  const enablePlanModeCommandEvent = useEffectEvent(onEnablePlanModeCommand);

  useEffect(() => {
    composerActiveIndexRef.current = composerActiveIndex;
  }, [composerActiveIndex]);

  useEffect(() => {
    composerSuggestionsRef.current = composerSuggestions;
  }, [composerSuggestions]);

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
    persistShellApprovalRef.current = false;
    setPersistShellApproval(false);
  }, [permissionRequestKey]);

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
    if (!composerFocused || !activeComposerToken || !currentSessionId) {
      setComposerSuggestions(null);
      setComposerActiveIndex(0);
      suggestionRequestVersionRef.current += 1;
      return;
    }

    if (activeComposerToken.kind === "slash") {
      setComposerSuggestions({
        token: activeComposerToken,
        items: buildComposerSlashSuggestionItems(activeComposerToken.query),
        loading: commandActionPending,
        truncated: false
      });
      setComposerActiveIndex(0);
      return;
    }

    const requestVersion = suggestionRequestVersionRef.current + 1;
    suggestionRequestVersionRef.current = requestVersion;
    setComposerSuggestions((current) => ({
      token: activeComposerToken,
      items:
        current &&
        current.token.kind === activeComposerToken.kind &&
        current.token.query === activeComposerToken.query
          ? current.items
          : [],
      loading: true,
      truncated: false
    }));

    const timeoutId = window.setTimeout(() => {
      const searchPromise =
        activeComposerToken.kind === "file"
          ? activeComposerToken.query.length === 0
            ? Promise.resolve<WorkspaceFileSearchResult>({
                items: [],
                truncated: false
              })
            : searchWorkspaceFilesEvent(
                activeComposerToken.query,
                COMPOSER_SUGGESTION_LIMIT
              )
          : searchWorkspaceSkillsEvent(
              activeComposerToken.query,
              COMPOSER_SUGGESTION_LIMIT
            );

      void searchPromise
        .then((result) => {
          if (suggestionRequestVersionRef.current !== requestVersion) {
            return;
          }

          const nextItems =
            activeComposerToken.kind === "file"
              ? buildComposerFileSuggestionItems(
                  result as WorkspaceFileSearchResult
                )
              : buildComposerSkillSuggestionItems(
                  result as WorkspaceSkillSearchResult
                );
          const previousSuggestions = composerSuggestionsRef.current;
          setComposerSuggestions({
            token: activeComposerToken,
            items: nextItems,
            loading: false,
            truncated: result.truncated
          });
          setComposerActiveIndex(
            getComposerSuggestionRefreshIndex({
              currentIndex: composerActiveIndexRef.current,
              previousItems:
                previousSuggestions?.token.kind === activeComposerToken.kind &&
                previousSuggestions.token.query === activeComposerToken.query
                  ? previousSuggestions.items
                  : [],
              nextItems
            })
          );
        })
        .catch(() => {
          if (suggestionRequestVersionRef.current !== requestVersion) {
            return;
          }

          setComposerSuggestions({
            token: activeComposerToken,
            items: [],
            loading: false,
            truncated: false
          });
          setComposerActiveIndex(0);
        });
    }, COMPOSER_SUGGESTION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeComposerToken,
    composerFocused,
    currentSessionId,
    commandActionPending
  ]);

  useEffect(() => {
    if (submitting) {
      autoFollowLatestRef.current = true;
    }
  }, [submitting]);

  useEffect(() => {
    setQuickActionsOpen(false);
  }, [currentSession?.sessionId]);

  useEffect(() => {
    setExpandedRunFileKeys(new Set());
  }, [currentSession?.sessionId]);

  useEffect(() => {
    setComposerSelection((current) => ({
      start: Math.min(current.start, message.length),
      end: Math.min(current.end, message.length)
    }));
  }, [message]);

  useLayoutEffect(() => {
    previousScrollSnapshotRef.current = null;
    pendingSessionEntryBottomScrollRef.current = true;
    previousViewportScrollTopRef.current = 0;
    autoFollowLatestRef.current = true;
    skipNextResizeAutoFollowRef.current = false;
    pendingCollapsedFlowScrollTargetRef.current = null;
    pendingAssistantRevealSkipKeyRef.current = null;
    clearPendingResizeAutoFollowSkip();
    clearPendingSmoothScrollReset();
  }, [currentSession?.sessionId, debugConversationView]);

  useEffect(() => {
    setComposerSuggestions(null);
    setComposerActiveIndex(0);
    setComposerFocused(false);
  }, [currentSession?.sessionId, debugConversationView]);

  useEffect(() => {
    return () => {
      clearPendingResizeAutoFollowSkip();
      clearPendingSmoothScrollReset();
    };
  }, []);

  useLayoutEffect(() => {
    if (pendingSessionEntryBottomScrollRef.current) {
      if (!scrollSnapshot.latestItemKey) {
        previousScrollSnapshotRef.current = scrollSnapshot;
        return;
      }

      pendingSessionEntryBottomScrollRef.current = false;
      scrollConversationViewportToBottom();
      previousScrollSnapshotRef.current = scrollSnapshot;
      return;
    }

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
    expandedItemKeys,
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

  return (
    <section className="rounded-[var(--app-radius-xl)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_96%,transparent)] shadow-none lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden">
      <header className="grid gap-3 px-4 pb-3 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
            Active Session
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate font-mono text-sm font-medium text-[var(--app-text-primary)]">
              {currentSession?.sessionId ?? "当前会话"}
            </h2>
            <CopyTextButton
              text={currentSession?.sessionId ?? ""}
              label="复制"
              copiedLabel="已复制"
              failedLabel="复制失败"
              title="复制会话 ID"
              ariaLabel="复制会话 ID"
            />
          </div>
          <div className="mt-2">
            <SessionGitStatusHeaderChips
              workspaceGitStatus={workspaceGitStatus}
              loading={workspaceGitStatusLoading}
            />
          </div>
        </div>
        {headerActions ? (
          <div className="flex shrink-0 items-center justify-start gap-3 lg:justify-end lg:justify-self-end">
            {headerActions}
          </div>
        ) : null}
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

              {conversationRenderEntries.length ? (
                conversationRenderEntries.map((entry) => {
                  if (entry.type === "run-file-changes") {
                    return (
                      <div
                        key={entry.key}
                        data-timeline-item-key={entry.key}
                        className="min-w-0"
                      >
                        {renderRunFileChangesPanel({
                          view: entry.view,
                          expandedFileKeys: expandedRunFileKeys,
                          onToggleFile(fileKey) {
                            setExpandedRunFileKeys((current) => {
                              const next = new Set(current);
                              if (next.has(fileKey)) {
                                next.delete(fileKey);
                              } else {
                                next.add(fileKey);
                              }
                              return next;
                            });
                          },
                          onSelectionChange: (selectedFileIndexes) =>
                            onRunFileSelectionChange(
                              entry.view.key,
                              selectedFileIndexes
                            ),
                          onAction: (action) =>
                            onRunFileChangeAction(entry.view.key, action)
                        })}
                      </div>
                    );
                  }

                  const rendered = renderedTimelineItems.find(
                    ({ item }) => item.key === entry.item.key
                  );
                  if (!rendered) {
                    return null;
                  }

                  return (
                    <div
                      key={entry.key}
                      data-timeline-item-key={entry.key}
                      className="min-w-0"
                    >
                      {rendered.content}
                    </div>
                  );
                })
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
                    <div className="flex min-w-0 flex-col gap-3">
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
                        <div className="mt-1 text-sm font-medium leading-6 text-[var(--app-text-primary)] [overflow-wrap:anywhere]">
                          {permissionCardView.summaryText}
                        </div>
                        {permissionCardView.detailText ? (
                          <div
                            className={`mt-2 max-w-full rounded-[var(--app-radius-md)] border px-3 py-2 text-xs leading-5 [overflow-wrap:anywhere] ${
                              permissionCardView.toolName ===
                                "run_shell_command" ||
                              permissionCardView.toolName ===
                                "make_http_request"
                                ? "font-mono"
                                : ""
                            } ${
                              permissionCardView.tone === "approved"
                                ? "border-[color:color-mix(in_srgb,var(--app-status-success)_30%,var(--app-border-subtle)_70%)] text-[var(--app-status-success)]"
                                : permissionCardView.tone === "rejected"
                                  ? "border-[color:color-mix(in_srgb,var(--app-status-danger)_32%,var(--app-border-subtle)_68%)] text-[var(--app-status-danger)]"
                                  : "border-[color:color-mix(in_srgb,var(--app-border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] text-[var(--app-text-secondary)]"
                            }`}
                          >
                            {permissionCardView.detailText}
                          </div>
                        ) : null}
                      </div>

                      {permissionCardView.showActions ? (
                        <div className="flex min-w-0 flex-col items-start gap-2">
                          {isShellPermissionRequest ? (
                            <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-text-muted)]">
                              <input
                                type="checkbox"
                                checked={persistShellApproval}
                                onChange={(event) => {
                                  persistShellApprovalRef.current =
                                    event.target.checked;
                                  setPersistShellApproval(event.target.checked);
                                }}
                                disabled={submitting}
                                className="h-4 w-4 accent-[var(--app-border-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                              />
                              <span>以后不再询问这条规则</span>
                            </label>
                          ) : null}
                          <div className="flex min-w-0 flex-wrap gap-2">
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
                                  void onPermissionQuickReply(option.reply, {
                                    persistShellApproval:
                                      isShellPermissionRequest &&
                                      persistShellApprovalRef.current
                                  });
                                }}
                                disabled={submitting}
                                className="max-w-full rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-3 py-1.5 text-left text-sm font-medium whitespace-normal text-[var(--app-text-primary)] transition [overflow-wrap:anywhere] hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
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
                                void onPermissionQuickReply("取消");
                              }}
                              disabled={submitting}
                              className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              取消
                            </button>
                          </div>
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

                {confirmationCardView ? (
                  <div
                    key={confirmationCardView.key}
                    className="relative z-0 rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-status-warning)_56%,var(--app-border-subtle)_44%)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-surface)_88%)] px-4 pb-4 pt-3"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                          Need Confirmation
                        </div>
                        <div className="mt-1 text-sm font-medium leading-6 text-[var(--app-text-primary)]">
                          {confirmationCardView.summaryText}
                        </div>
                        {confirmationCardView.conflictItems?.length ? (
                          <div className="mt-3 grid gap-2">
                            <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                              当前冲突
                            </div>
                            <div className="grid gap-2">
                              {confirmationCardView.conflictItems.map(
                                (item) => (
                                  <div
                                    key={item.routineId}
                                    className="rounded-[var(--app-radius-md)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_94%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--app-text-secondary)]"
                                  >
                                    {item.previewText}
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-2">
                          <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                            待执行调整
                          </div>
                          <div className="grid gap-2">
                            {confirmationCardView.proposedItems.map(
                              (item, index) => (
                                <div
                                  key={`${confirmationCardView.key}-${index}`}
                                  className="rounded-[var(--app-radius-md)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_94%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--app-text-secondary)]"
                                >
                                  {item.previewText}
                                </div>
                              )
                            )}
                          </div>
                        </div>
                        {confirmationCardView.contextNote ? (
                          <div className="mt-3 text-xs text-[var(--app-text-muted)]">
                            {confirmationCardView.contextNote}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void onConfirmationQuickReply("确认")}
                          disabled={submitting}
                          className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          确认执行
                        </button>
                        <button
                          type="button"
                          onClick={() => void onConfirmationQuickReply("取消")}
                          disabled={submitting}
                          className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          暂不执行
                        </button>
                      </div>

                      <div className="text-xs text-[var(--app-text-muted)]">
                        也可以直接回复新的时间或调整方案。
                      </div>
                    </div>
                  </div>
                ) : null}

                {userQuestionCardView ? (
                  <div
                    key={userQuestionCardView.key}
                    className="relative z-0 rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-status-warning)_56%,var(--app-border-subtle)_44%)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_12%,var(--app-bg-surface)_88%)] px-4 pb-4 pt-3"
                  >
                    <div className="flex min-w-0 flex-col gap-3">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                          Need Clarification
                        </div>
                        {userQuestionCardView.questions.length > 1 ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              aria-label="上一个问题"
                              onClick={() =>
                                setActiveUserQuestionIndex((current) =>
                                  Math.max(0, current - 1)
                                )
                              }
                              disabled={
                                submitting || activeUserQuestionIndex === 0
                              }
                              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {"<"}
                            </button>
                            <div className="min-w-16 text-center font-mono text-[0.72rem] uppercase tracking-[0.12em] text-[var(--app-text-muted)]">
                              {activeUserQuestionIndex + 1} /{" "}
                              {userQuestionCardView.questions.length} 问题
                            </div>
                            <button
                              type="button"
                              aria-label="下一个问题"
                              onClick={() =>
                                setActiveUserQuestionIndex((current) =>
                                  Math.min(
                                    userQuestionCardView.questions.length - 1,
                                    current + 1
                                  )
                                )
                              }
                              disabled={
                                submitting ||
                                activeUserQuestionIndex >=
                                  userQuestionCardView.questions.length - 1
                              }
                              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] text-sm text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {">"}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {userQuestionCardView.questions.length > 1 ? (
                        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
                          {userQuestionCardView.questions.map(
                            (question, index) => (
                              <button
                                key={`${userQuestionCardView.key}:${index}:${question.questionText}`}
                                type="button"
                                onClick={() =>
                                  setActiveUserQuestionIndex(index)
                                }
                                className={`shrink-0 rounded-[var(--app-radius-pill)] border px-3 py-1.5 text-xs font-medium transition ${
                                  activeUserQuestionIndex === index
                                    ? "border-[var(--app-status-warning)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_18%,var(--app-bg-elevated)_82%)] text-[var(--app-text-primary)]"
                                    : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-secondary)]"
                                }`}
                              >
                                问题 {index + 1}
                              </button>
                            )
                          )}
                        </div>
                      ) : null}

                      {activeUserQuestion ? (
                        <div className="min-w-0">
                          <div className="text-sm font-medium leading-6 text-[var(--app-text-primary)] [overflow-wrap:anywhere]">
                            {activeUserQuestion.questionText}
                          </div>

                          {activeUserQuestion.options.length > 0 ? (
                            <div className="mt-3 grid gap-2">
                              {activeUserQuestion.options.map((option) => (
                                <button
                                  key={`${activeUserQuestionIndex}:${option.label}:${option.reply}`}
                                  type="button"
                                  title={option.description}
                                  onClick={() =>
                                    setUserQuestionReply(
                                      activeUserQuestionIndex,
                                      option.reply
                                    )
                                  }
                                  disabled={submitting}
                                  className={`min-w-0 rounded-[var(--app-radius-md)] border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                    userQuestionReplyDraft === option.reply
                                      ? "border-[var(--app-status-warning)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_18%,var(--app-bg-elevated)_82%)] text-[var(--app-text-primary)]"
                                      : option.isRecommended
                                        ? "border-[color:color-mix(in_srgb,var(--app-status-warning)_60%,var(--app-border-subtle)_40%)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_10%,var(--app-bg-elevated)_90%)] text-[var(--app-text-primary)]"
                                        : "border-[var(--app-border-subtle)] bg-[var(--app-bg-elevated)] text-[var(--app-text-secondary)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-primary)]"
                                  }`}
                                >
                                  <span className="flex min-w-0 items-start justify-between gap-3">
                                    <span className="min-w-0">
                                      <span className="block font-medium [overflow-wrap:anywhere]">
                                        {option.label}
                                        {option.isRecommended
                                          ? " (Recommended)"
                                          : ""}
                                      </span>
                                      {option.description ? (
                                        <span className="mt-1 block text-xs leading-5 text-[var(--app-text-muted)] [overflow-wrap:anywhere]">
                                          {option.description}
                                        </span>
                                      ) : null}
                                    </span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}

                          {activeUserQuestion.allowCancel !== false ? (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setUserQuestionReply(
                                    activeUserQuestionIndex,
                                    "取消"
                                  )
                                }
                                disabled={submitting}
                                className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--app-text-secondary)] transition hover:border-[var(--app-status-danger)] hover:text-[var(--app-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                取消
                              </button>
                            </div>
                          ) : null}

                          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
                            <label className="min-w-0 flex-1">
                              <span className="sr-only">直接输入你的回答</span>
                              <textarea
                                value={userQuestionReplyDraft}
                                onChange={(event) =>
                                  setUserQuestionReply(
                                    activeUserQuestionIndex,
                                    event.currentTarget.value
                                  )
                                }
                                rows={2}
                                placeholder="或者在这里直接输入你的回答"
                                className="w-full resize-none rounded-[var(--app-radius-md)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-canvas)_12%,var(--app-bg-surface)_88%)] px-3 py-2 text-sm leading-6 text-[var(--app-text-primary)] outline-none transition placeholder:text-[var(--app-text-muted)] focus:border-[var(--app-border-accent)]"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                if (userQuestionReplyMessage) {
                                  onUserQuestionQuickReply(
                                    userQuestionReplyMessage
                                  );
                                }
                              }}
                              disabled={!userQuestionReplyMessage || submitting}
                              className="rounded-[var(--app-radius-pill)] border border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--app-text-primary)] transition hover:border-[var(--app-status-success)] hover:text-[var(--app-status-success)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              发送
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div ref={composerContainerRef} className="relative">
                  {composerFocused && composerSuggestions ? (
                    <div className="absolute bottom-full left-0 right-0 z-30 mb-2 rounded-[var(--app-radius-lg)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_98%,transparent)] p-2 shadow-none">
                      {composerSuggestions.items.length > 0 ? (
                        <div className="grid gap-1">
                          {composerSuggestions.items.map((item, index) => {
                            const active = index === composerActiveIndex;
                            return (
                              <button
                                key={item.key}
                                type="button"
                                onMouseEnter={() =>
                                  setComposerActiveIndex(index)
                                }
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  setComposerActiveIndex(index);
                                  void handleComposerSuggestionSelect(item);
                                }}
                                className={`flex w-full items-start justify-between gap-3 rounded-[var(--app-radius-md)] px-3 py-2 text-left transition ${
                                  active
                                    ? "bg-[color:color-mix(in_srgb,var(--app-bg-muted)_72%,transparent)] text-[var(--app-text-primary)]"
                                    : "text-[var(--app-text-secondary)] hover:bg-[color:color-mix(in_srgb,var(--app-bg-muted)_52%,transparent)] hover:text-[var(--app-text-primary)]"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-mono text-[0.78rem] text-[var(--app-text-primary)]">
                                    {item.label}
                                  </div>
                                  <div className="mt-0.5 line-clamp-2 text-xs text-[var(--app-text-muted)]">
                                    {item.description}
                                  </div>
                                </div>
                                <div className="shrink-0 text-[0.65rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                                  {item.kind}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="px-3 py-2 text-sm text-[var(--app-text-muted)]">
                          {getComposerSuggestionsEmptyState({
                            kind: composerSuggestions.token.kind,
                            query: composerSuggestions.token.query,
                            loading: composerSuggestions.loading
                          })}
                        </div>
                      )}
                      {composerSuggestions.truncated ? (
                        <div className="px-3 pt-2 text-[0.72rem] text-[var(--app-text-muted)]">
                          结果过多，仅显示前 {COMPOSER_SUGGESTION_LIMIT} 项
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <textarea
                    ref={composerTextareaRef}
                    value={message}
                    onFocus={() => setComposerFocused(true)}
                    onBlur={() => setComposerFocused(false)}
                    onChange={(event) =>
                      handleComposerMessageChange(event.currentTarget)
                    }
                    onSelect={(event) =>
                      syncComposerSelection(event.currentTarget)
                    }
                    onKeyDown={handleComposerKeyDown}
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
                            <label className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_92%,transparent)] px-3 py-2.5 text-sm text-[var(--app-text-secondary)]">
                              <div>
                                <div className="text-sm text-[var(--app-text-primary)]">
                                  YOLO
                                </div>
                              </div>
                              <WorkbenchSwitch
                                checked={
                                  currentSession?.context.yoloMode ?? false
                                }
                                onChange={onSettingsYoloModeChange}
                                disabled={!currentSession}
                                ariaLabel="切换当前会话的 YOLO 模式"
                              />
                            </label>

                            <label className="flex items-center justify-between gap-3 rounded-[var(--app-radius-lg)] border border-[var(--app-border-subtle)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_92%,transparent)] px-3 py-2.5 text-sm text-[var(--app-text-secondary)]">
                              <div>
                                <div className="text-sm text-[var(--app-text-primary)]">
                                  Plan Mode
                                </div>
                              </div>
                              <WorkbenchSwitch
                                checked={
                                  currentSession?.context.planModeEnabled ??
                                  false
                                }
                                onChange={onSessionPlanModeChange}
                                disabled={!currentSession}
                                ariaLabel="切换当前会话的 Plan Mode"
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
                    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[var(--app-radius-pill)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_68%,transparent)] px-2.5 py-1 font-mono text-[0.7rem] leading-none text-[var(--app-text-secondary)]">
                      <span className="shrink-0 uppercase tracking-[0.12em] text-[var(--app-text-muted)]">
                        cwd
                      </span>
                      <span
                        title={currentWorkingDirectory}
                        className="min-w-0 truncate text-[var(--app-text-primary)]"
                      >
                        {currentWorkingDirectoryLabel}
                      </span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-[var(--app-radius-pill)] border px-2.5 py-1 font-mono text-[0.7rem] leading-none ${
                        yoloModeEnabled
                          ? "border-[color:color-mix(in_srgb,var(--app-status-success)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--app-status-success)_11%,var(--app-bg-muted)_89%)] text-[var(--app-status-success)]"
                          : "border-[color:color-mix(in_srgb,var(--app-border-subtle)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_60%,transparent)] text-[var(--app-text-muted)]"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          yoloModeEnabled
                            ? "bg-[var(--app-status-success)]"
                            : "bg-[var(--app-text-muted)]"
                        }`}
                      />
                      <span className="uppercase tracking-[0.12em]">yolo</span>
                      <span className="text-[var(--app-text-primary)]">
                        {yoloModeEnabled ? "on" : "off"}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-[var(--app-radius-pill)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_46%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_52%,transparent)] px-2.5 py-1 font-mono text-[0.7rem] leading-none text-[var(--app-text-muted)]">
                      <span className="uppercase tracking-[0.12em]">
                        peak ctx
                      </span>
                      <span className="text-[var(--app-text-secondary)]">
                        {peakContextUsageLabel}
                      </span>
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <div className="w-44 max-w-[52vw]">
                      <WorkbenchSelect
                        value={selectedModelId}
                        disabled={!currentSession}
                        ariaLabel="选择当前会话模型"
                        onValueChange={onSettingsModelChange}
                        options={modelCatalog.map((model) => ({
                          value: model.id,
                          label: model.configured
                            ? model.label
                            : `${model.label} (unavailable)`,
                          disabled: !model.configured
                        }))}
                      />
                    </div>
                    {thinkingEffortOptions.length > 0 ? (
                      <div className="w-28 max-w-[34vw]">
                        <WorkbenchSelect
                          value={selectedThinkingEffort}
                          disabled={!currentSession}
                          ariaLabel="选择 thinking effort"
                          onValueChange={onSettingsThinkingEffortChange}
                          options={thinkingEffortOptions.map((effort) => ({
                            value: effort,
                            label: effort
                          }))}
                        />
                      </div>
                    ) : null}
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
