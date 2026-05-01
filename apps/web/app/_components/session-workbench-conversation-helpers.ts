import {
  buildShellApprovalPatternCandidates,
  type SessionSnapshot,
  type WorkspaceFileSearchResult,
  type WorkspaceSkillSearchResult
} from "@ai-app-template/sdk";

import {
  filterComposerSlashCommands,
  type ComposerCommandKind,
  type ComposerCommandTokenMatch,
  type ComposerSlashCommand
} from "./session-composer-commands";

export type ComposerSuggestionItem =
  | {
      key: string;
      kind: "slash";
      label: string;
      title: string;
      description: string;
      replacement: string;
      command: ComposerSlashCommand["id"];
    }
  | {
      key: string;
      kind: "file";
      label: string;
      title: string;
      description: string;
      replacement: string;
    }
  | {
      key: string;
      kind: "skill";
      label: string;
      title: string;
      description: string;
      replacement: string;
    };

export interface ComposerSuggestionsState {
  token: ComposerCommandTokenMatch;
  items: ComposerSuggestionItem[];
  loading: boolean;
  truncated: boolean;
}

export function buildComposerSlashSuggestionItems(
  query: string
): ComposerSuggestionItem[] {
  return filterComposerSlashCommands(query).map((command) => ({
    key: `slash:${command.id}`,
    kind: "slash",
    label: command.label,
    title: command.label,
    description: command.description,
    replacement: command.label,
    command: command.id
  }));
}

export function buildComposerFileSuggestionItems(
  result: WorkspaceFileSearchResult
): ComposerSuggestionItem[] {
  return result.items.map((item) => ({
    key: `file:${item.path}`,
    kind: "file",
    label: item.path,
    title: item.path,
    description: item.name,
    replacement: `@${item.path}`
  }));
}

export function buildComposerSkillSuggestionItems(
  result: WorkspaceSkillSearchResult
): ComposerSuggestionItem[] {
  return result.items.map((item) => ({
    key: `skill:${item.name}`,
    kind: "skill",
    label: `#${item.name}`,
    title: item.name,
    description: item.description,
    replacement: `#${item.name}`
  }));
}

export function getComposerSuggestionsEmptyState(input: {
  kind: ComposerCommandKind;
  query: string;
  loading: boolean;
}): string {
  if (input.loading) {
    return input.kind === "file" ? "正在搜索文件..." : "正在搜索 skill...";
  }

  if (input.kind === "file" && input.query.length === 0) {
    return "继续输入以搜索文件";
  }

  if (input.kind === "slash") {
    return "没有匹配的命令";
  }

  return input.kind === "file" ? "没有匹配的文件" : "没有匹配的 skill";
}

interface BackgroundNotificationCopySource {
  summary: string;
  content: string;
}

function normalizeBackgroundNotificationText(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildBackgroundNotificationCopy(
  notification: BackgroundNotificationCopySource
): {
  summaryText: string | null;
  contentText: string | null;
} {
  const summaryText = normalizeBackgroundNotificationText(notification.summary);
  const contentText = normalizeBackgroundNotificationText(notification.content);

  if (!summaryText) {
    return {
      summaryText: null,
      contentText
    };
  }

  if (!contentText || contentText === summaryText) {
    return {
      summaryText,
      contentText: null
    };
  }

  return {
    summaryText,
    contentText
  };
}

export function getBackgroundNotificationKindLabel(kind: string): string {
  switch (kind) {
    case "task_completed":
      return "completed";
    case "task_waiting":
      return "waiting";
    case "task_failed":
      return "failed";
    case "task_cancelled":
      return "cancelled";
    case "task_timeout":
      return "timeout";
    default:
      return kind;
  }
}

function isSubagentBackgroundNotification(
  taskKind: string | null | undefined
): boolean {
  return taskKind === "subagent";
}

export function getBackgroundNotificationCardLabel(input: {
  taskKind: string | null | undefined;
  isConsumed: boolean;
}): string {
  if (input.isConsumed) {
    return isSubagentBackgroundNotification(input.taskKind)
      ? "子代理反馈"
      : "后台任务";
  }

  return "后台更新";
}

export function getBackgroundNotificationHeadline(input: {
  kind: string;
  title: string;
  taskKind: string | null | undefined;
  isConsumed: boolean;
}): string {
  if (!input.isConsumed) {
    return input.title;
  }

  if (isSubagentBackgroundNotification(input.taskKind)) {
    return "主代理接受了子代理的反馈";
  }

  switch (input.kind) {
    case "task_failed":
      return "后台任务失败";
    case "task_cancelled":
      return "后台任务已取消";
    case "task_timeout":
      return "后台任务超时";
    default:
      return "后台任务已完成";
  }
}

type PermissionCardTone = "pending" | "approved" | "rejected";

export interface PermissionCardFeedback {
  requestKey: string;
  toolName: string;
  summaryText: string;
  detailText?: string;
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
  questions: NonNullable<
    SessionSnapshot["context"]["pendingUserQuestionPayload"]
  >["questions"];
}

interface ConfirmationCardView {
  key: string;
  summaryText: string;
  proposedItems: NonNullable<
    SessionSnapshot["context"]["pendingConfirmationPayload"]
  >["proposedItems"];
  conflictItems: NonNullable<
    SessionSnapshot["context"]["pendingConfirmationPayload"]
  >["conflictItems"];
  contextNote?: string;
}

function buildShellApprovalReplies(
  command: string
): Array<{ label: string; reply: string }> {
  return buildShellApprovalPatternCandidates(command).map((pattern) => {
    const reply = `本会话允许 shell:${pattern}`;
    return { label: reply, reply };
  });
}

function buildPermissionCardText(
  request: SessionSnapshot["context"]["pendingPermissionRequest"]
): { summaryText: string; detailText?: string } {
  if (!request) {
    return { summaryText: "" };
  }

  if (request.toolName === "run_shell_command") {
    const command =
      typeof request.toolInput.command === "string"
        ? request.toolInput.command.trim()
        : "";
    if (command) {
      return {
        summaryText: "需要你的确认后才能执行 shell 命令",
        detailText: command
      };
    }
  }

  if (request.toolName === "make_http_request") {
    const url =
      typeof request.toolInput.url === "string"
        ? request.toolInput.url.trim()
        : "";
    if (url) {
      return {
        summaryText: "需要你的确认后才能执行网络请求",
        detailText: url
      };
    }
  }

  return {
    summaryText: request.summaryText
  };
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
        ? request.toolInput.command
        : "";
    const replies = buildShellApprovalReplies(command);
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

  const cardText = buildPermissionCardText(request);

  return {
    requestKey,
    toolName: request.toolName,
    summaryText: cardText.summaryText,
    ...(cardText.detailText ? { detailText: cardText.detailText } : {}),
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
      ...(feedback.detailText ? { detailText: feedback.detailText } : {}),
      tone: feedback.tone,
      title: feedback.tone === "approved" ? "已同意" : "已取消",
      showActions: false
    };
  }

  if (!pendingPermissionRequest || !requestKey) {
    return null;
  }

  const cardText = buildPermissionCardText(pendingPermissionRequest);

  return {
    key: requestKey,
    toolName: pendingPermissionRequest.toolName,
    summaryText: cardText.summaryText,
    ...(cardText.detailText ? { detailText: cardText.detailText } : {}),
    tone: "pending",
    title: "Permission Request",
    showActions: true
  };
}

export interface ComposerActionView {
  buttonLabel: string;
  buttonType: "submit" | "interrupt";
  disabled: boolean;
}

export type ComposerEnterKeyIntent =
  | "submit"
  | "newline"
  | "select-command"
  | "ignore";

export function buildComposerActionView(input: {
  canInterrupt: boolean;
  interrupting: boolean;
  canSubmit: boolean;
}): ComposerActionView {
  if (input.interrupting) {
    return {
      buttonLabel: "强制结束",
      buttonType: "interrupt",
      disabled: false
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

export function getComposerEnterKeyIntent(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  commandMenuOpen?: boolean;
}): ComposerEnterKeyIntent {
  if (input.key !== "Enter" || input.isComposing) {
    return "ignore";
  }

  if (input.shiftKey) {
    return "newline";
  }

  return input.commandMenuOpen ? "select-command" : "submit";
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
    questions: payload.questions
  };
}

export function buildUserQuestionReplyMessage(input: {
  payload: SessionSnapshot["context"]["pendingUserQuestionPayload"];
  replies: string[];
}): string | null {
  const payload = input.payload;
  if (!payload) {
    return null;
  }

  const normalizedReplies = payload.questions.map(
    (_, index) => input.replies[index]?.trim() ?? ""
  );
  if (!normalizedReplies.some((reply) => reply.length > 0)) {
    return null;
  }

  if (payload.questions.length === 1) {
    return normalizedReplies[0] ?? null;
  }

  return payload.questions
    .map((question, index) =>
      [
        `问题 ${index + 1}：${question.questionText}`,
        `回答：${normalizedReplies[index] || "暂未回答"}`
      ].join("\n")
    )
    .join("\n\n");
}

export function getConfirmationKey(
  payload: SessionSnapshot["context"]["pendingConfirmationPayload"]
): string | null {
  if (!payload) {
    return null;
  }

  return payload.createdAt;
}

export function buildConfirmationCardView(
  payload: SessionSnapshot["context"]["pendingConfirmationPayload"]
): ConfirmationCardView | null {
  const key = getConfirmationKey(payload);
  if (!payload || !key) {
    return null;
  }

  return {
    key,
    summaryText: payload.summaryText,
    proposedItems: payload.proposedItems,
    conflictItems: payload.conflictItems,
    ...(payload.contextNote ? { contextNote: payload.contextNote } : {})
  };
}
