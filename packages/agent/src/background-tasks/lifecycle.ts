import type {
  BackgroundNotificationKind,
  BackgroundNotificationRequest,
  BackgroundTaskKind,
  BackgroundTaskRecord,
  BackgroundTaskResultEnvelope,
  DelegateExpectedParentReply,
  DomainJsonValue
} from "@ai-app-template/domain";

export interface BackgroundTaskLifecycleNotificationEnvelope {
  title: string;
  summary: string;
  content: string;
  expectedParentReply: DelegateExpectedParentReply;
  request?: BackgroundNotificationRequest | null;
  result?: BackgroundTaskResultEnvelope | null;
}

export interface BackgroundTaskLifecycleNotificationInput {
  task: BackgroundTaskRecord;
  kind: BackgroundNotificationKind;
  fallbackSummary: string;
  fallbackContent: string;
  title?: string;
  result?: BackgroundTaskResultEnvelope | null;
}

export interface StaleBackgroundTaskLifecycleNotification {
  kind: BackgroundNotificationKind;
  fallbackSummary: string;
  fallbackContent: string;
  autoWake?: boolean;
  decrementActiveTaskCount: boolean;
}

const DEFAULT_NOTIFICATION_TITLES: Record<BackgroundTaskKind, string> = {
  cron_job: "计划任务",
  hook_subagent: "预运行 Hook",
  session_wakeup: "主会话后台续跑",
  shell_command: "后台任务",
  subagent: "后台子任务"
};

const DEFAULT_TIMEOUT_SUMMARIES: Record<BackgroundTaskKind, string> = {
  cron_job: "计划任务超时。",
  hook_subagent: "预运行 Hook 超时。",
  session_wakeup: "主会话后台续跑超时。",
  shell_command: "后台任务超时。",
  subagent: "后台子任务超时。"
};

export function resolveBackgroundTaskNotificationTitle(input: {
  task: BackgroundTaskRecord;
  title?: string;
}): string {
  if (input.title) {
    return input.title;
  }

  if (input.task.taskState?.kind === "delegate") {
    return input.task.taskState.title;
  }

  if (input.task.taskState?.kind === "hook_subagent") {
    return input.task.taskState.title;
  }

  return DEFAULT_NOTIFICATION_TITLES[input.task.kind];
}

export function shouldDecrementActiveTaskCountOnNotification(
  task: BackgroundTaskRecord
): boolean {
  return task.kind !== "session_wakeup" && !!task.parentSessionId;
}

export function buildBackgroundTaskLifecycleNotificationEnvelope(
  input: BackgroundTaskLifecycleNotificationInput
): BackgroundTaskLifecycleNotificationEnvelope {
  const title = resolveBackgroundTaskNotificationTitle({
    task: input.task,
    ...(input.title ? { title: input.title } : {})
  });

  if (input.task.kind === "subagent") {
    const taskState =
      input.task.taskState?.kind === "delegate" ? input.task.taskState : null;
    const latestResponse = taskState?.latestResponse;
    return {
      title,
      summary: latestResponse?.summary ?? input.fallbackSummary,
      content: latestResponse?.content ?? input.fallbackContent,
      expectedParentReply: taskState?.expectedParentReply ?? "none",
      request: latestResponse?.request ?? null,
      result: latestResponse
        ? {
            type: "delegate",
            summary: latestResponse.summary,
            content: latestResponse.content,
            responseKind: latestResponse.kind,
            expectedParentReply: taskState?.expectedParentReply ?? "none",
            ...(latestResponse.request
              ? { request: latestResponse.request }
              : {})
          }
        : null
    };
  }

  if (input.task.kind === "shell_command") {
    return {
      title,
      summary: input.fallbackSummary,
      content: input.fallbackContent,
      expectedParentReply: "none",
      result:
        typeof input.result !== "undefined"
          ? input.result
          : input.task.taskState?.kind === "shell_command"
            ? input.task.taskState.latestResult
            : null
    };
  }

  if (input.task.kind === "hook_subagent") {
    return {
      title,
      summary: input.fallbackSummary,
      content: input.fallbackContent,
      expectedParentReply: "none",
      result:
        typeof input.result !== "undefined"
          ? input.result
          : input.task.taskState?.kind === "hook_subagent"
            ? input.task.taskState.latestResult
            : null
    };
  }

  return {
    title,
    summary: input.fallbackSummary,
    content: input.fallbackContent,
    expectedParentReply: "none",
    ...(typeof input.result !== "undefined" ? { result: input.result } : {})
  };
}

export function buildStaleBackgroundTaskLifecycleNotification(
  task: BackgroundTaskRecord
): StaleBackgroundTaskLifecycleNotification {
  return {
    kind: "task_timeout",
    fallbackSummary: task.resultSummary ?? DEFAULT_TIMEOUT_SUMMARIES[task.kind],
    fallbackContent:
      task.lastError ?? "Worker claim expired before completion.",
    ...(task.kind === "session_wakeup" ? { autoWake: false } : {}),
    decrementActiveTaskCount: shouldDecrementActiveTaskCountOnNotification(task)
  };
}

export function resolveHookSubagentWakeupOptions(task: BackgroundTaskRecord): {
  wakeupMessage?: string;
  wakeupMetadata?: Record<string, DomainJsonValue>;
} {
  if (
    task.kind !== "hook_subagent" ||
    task.payload.executor !== "agent_session"
  ) {
    return {};
  }

  const wakeupMessage =
    typeof task.payload.metadata.resumeMessage === "string"
      ? task.payload.metadata.resumeMessage
      : undefined;
  const wakeupMetadata =
    wakeupMessage && task.payload.metadata.skipSubagentHooks === true
      ? { skipSubagentHooks: true as const }
      : undefined;

  return {
    ...(wakeupMessage ? { wakeupMessage } : {}),
    ...(wakeupMetadata ? { wakeupMetadata } : {})
  };
}
