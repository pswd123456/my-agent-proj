import type {
  BackgroundTaskHandle,
  BackgroundTaskKind,
  BackgroundTaskRecord,
  BackgroundTaskWaitMode
} from "@ai-app-template/domain";

import type { RunSessionResult } from "../types.js";

export const BACKGROUND_TASK_ACCEPTED_CODE = "BACKGROUND_TASK_ACCEPTED";

export function buildBackgroundTaskHandle(input: {
  task: BackgroundTaskRecord;
  waitMode: BackgroundTaskWaitMode;
  initialCheckAfterMs: number;
}): BackgroundTaskHandle {
  return {
    taskId: input.task.taskId,
    taskKind: input.task.kind,
    status: input.task.status,
    waitMode: input.waitMode,
    initialCheckAfterMs: input.initialCheckAfterMs
  };
}

function isActiveBackgroundTaskStatus(status: unknown): boolean {
  return (
    status === "queued" ||
    status === "claimed" ||
    status === "running" ||
    status === "cancelling"
  );
}

export function readAcceptedBackgroundTaskHandle(
  output: RunSessionResult["toolOutputs"][number]
): BackgroundTaskHandle | null {
  if (output.isError) {
    return null;
  }

  try {
    const parsed = JSON.parse(output.content) as {
      ok?: boolean;
      data?: {
        background_task?: {
          task_id?: unknown;
          task_kind?: unknown;
          status?: unknown;
          wait_mode?: unknown;
          initial_check_after_ms?: unknown;
        };
      };
    };
    const handle = parsed?.data?.background_task;
    if (!handle || parsed.ok !== true) {
      return null;
    }
    if (
      typeof handle.task_id !== "string" ||
      typeof handle.task_kind !== "string" ||
      !isActiveBackgroundTaskStatus(handle.status)
    ) {
      return null;
    }

    return {
      taskId: handle.task_id,
      taskKind: handle.task_kind as BackgroundTaskKind,
      status: handle.status as BackgroundTaskRecord["status"],
      waitMode:
        handle.wait_mode === "unblocking" ? "unblocking" : "blocking",
      initialCheckAfterMs:
        typeof handle.initial_check_after_ms === "number" &&
        Number.isFinite(handle.initial_check_after_ms)
          ? Math.max(
              1_000,
              Math.min(120_000, Math.floor(handle.initial_check_after_ms))
            )
          : 5_000
    };
  } catch {
    return null;
  }
}
