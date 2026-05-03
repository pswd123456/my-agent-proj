import type {
  RunStreamEvent,
  SessionSnapshot,
  WorkspaceFileChangeSummary
} from "@ai-app-template/sdk";

import type { RunFileChangesView } from "./session-workbench-conversation";

export type RunFileChangesState = RunFileChangesView;

export function getRunFileChangesAggregateState(
  fileStates: Array<"applied" | "undone">
): RunFileChangesState["state"] {
  if (fileStates.length === 0) {
    return "applied";
  }

  const firstState = fileStates[0] ?? "applied";
  return fileStates.every((state) => state === firstState)
    ? firstState
    : "mixed";
}

export function getSelectedWorkspaceFileChanges(
  view: RunFileChangesState
): WorkspaceFileChangeSummary[] {
  return view.selectedFileIndexes.flatMap((index) => {
    const file = view.files[index];
    return file ? [file] : [];
  });
}

function buildRunFileChangesStateFromFiles(input: {
  key: string;
  createdAt: string;
  files: WorkspaceFileChangeSummary[];
}): RunFileChangesState {
  return {
    key: input.key,
    createdAt: input.createdAt,
    files: input.files,
    fileStates: input.files.map(() => "applied" as const),
    state: "applied",
    selectedFileIndexes: input.files.map((_, index) => index),
    pendingAction: null,
    errorText: null
  };
}

export function buildRunFileChangesStatesFromSession(
  session: SessionSnapshot | null
): RunFileChangesState[] {
  if (!session) {
    return [];
  }

  const views: RunFileChangesState[] = [];
  let runIndex = 0;
  let runKey = `run-file-changes:${session.sessionId}:prelude`;
  let runCreatedAt = "";
  let files: WorkspaceFileChangeSummary[] = [];

  function flushRun() {
    if (files.length === 0) {
      return;
    }

    views.push(
      buildRunFileChangesStateFromFiles({
        key: runKey,
        createdAt: runCreatedAt,
        files
      })
    );
    files = [];
    runCreatedAt = "";
  }

  for (const block of session.messages) {
    if (block.kind === "user") {
      flushRun();
      runIndex += 1;
      runKey = `run-file-changes:${session.sessionId}:${block.id}`;
      runCreatedAt = block.createdAt;
      continue;
    }

    if (
      block.kind !== "tool result" ||
      block.isError ||
      block.details?.kind !== "workspace_file_changes" ||
      block.details.files.length === 0
    ) {
      continue;
    }

    files = [...files, ...block.details.files];
    runCreatedAt =
      runCreatedAt && runCreatedAt > block.createdAt
        ? runCreatedAt
        : block.createdAt;

    if (runKey.endsWith(":prelude")) {
      runKey = `run-file-changes:${session.sessionId}:prelude-${runIndex}`;
    }
  }

  flushRun();
  return views;
}

export function mergeRunFileChangesStates(
  current: RunFileChangesState[],
  next: RunFileChangesState[]
): RunFileChangesState[] {
  const currentByKey = new Map(current.map((view) => [view.key, view]));

  return next.map((view) => {
    const existing = currentByKey.get(view.key);
    if (!existing) {
      return view;
    }

    const filesStillMatch =
      existing.files.length === view.files.length &&
      existing.files.every(
        (file, index) => file.path === view.files[index]?.path
      );
    if (!filesStillMatch) {
      return view;
    }

    const fileStates = view.files.map(
      (_, index) => existing.fileStates[index] ?? "applied"
    );
    const selectedFileIndexes = existing.selectedFileIndexes.filter(
      (index) => index >= 0 && index < view.files.length
    );

    return {
      ...view,
      fileStates,
      state: getRunFileChangesAggregateState(fileStates),
      selectedFileIndexes,
      pendingAction: existing.pendingAction,
      errorText: existing.errorText
    };
  });
}

export function collectWorkspaceFileChangesFromRun(
  event: Extract<RunStreamEvent, { kind: "run_complete" | "run_error" }>
): WorkspaceFileChangeSummary[] {
  if (!("toolOutputs" in event)) {
    return [];
  }

  return event.toolOutputs.flatMap((output) => {
    if (
      output.isError ||
      output.details?.kind !== "workspace_file_changes" ||
      output.details.files.length === 0
    ) {
      return [];
    }

    return output.details.files;
  });
}

export function buildRunFileChangesState(
  event: Extract<RunStreamEvent, { kind: "run_complete" | "run_error" }>
): RunFileChangesState | null {
  const files = collectWorkspaceFileChangesFromRun(event);
  if (files.length === 0) {
    return null;
  }

  return {
    key: `run-file-changes:${event.createdAt}`,
    createdAt: event.createdAt,
    files,
    fileStates: files.map(() => "applied" as const),
    state: "applied",
    selectedFileIndexes: files.map((_, index) => index),
    pendingAction: null,
    errorText: null
  };
}
