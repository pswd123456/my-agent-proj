import type { WorkspaceFileChangeSummary } from "@ai-app-template/sdk";

import type { CompactToolViewItem } from "./session-conversation-view";
import { getDebugPreClass } from "./session-workbench-shared";

export type UnifiedDiffLineTone =
  | "add"
  | "remove"
  | "hunk"
  | "header"
  | "context";

export function getCompactToolFileChangeRows(
  item: Pick<CompactToolViewItem, "fileChanges">
): Array<{
  path: string;
  action: "modify" | "create" | "delete";
  countsLabel: string;
  diff: string;
}> {
  return getWorkspaceFileChangeRows(item.fileChanges ?? []);
}

export function getWorkspaceFileChangeRows(
  files: WorkspaceFileChangeSummary[]
): Array<{
  path: string;
  action: "modify" | "create" | "delete";
  countsLabel: string;
  diff: string;
}> {
  return files.map((file) => ({
    path: file.path,
    action: file.action,
    countsLabel: `+${file.addedLineCount} / -${file.removedLineCount}`,
    diff: file.diff
  }));
}

export function getUnifiedDiffLineTone(line: string): UnifiedDiffLineTone {
  if (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  ) {
    return "header";
  }

  if (line.startsWith("@@")) {
    return "hunk";
  }

  if (line.startsWith("+")) {
    return "add";
  }

  if (line.startsWith("-")) {
    return "remove";
  }

  return "context";
}

function getUnifiedDiffLineClass(tone: UnifiedDiffLineTone): string {
  switch (tone) {
    case "add":
      return "border-[color:color-mix(in_srgb,var(--app-status-success)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-status-success)_13%,transparent)] text-[color:color-mix(in_srgb,var(--app-status-success)_86%,var(--app-text-primary)_14%)]";
    case "remove":
      return "border-[color:color-mix(in_srgb,var(--app-status-danger)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-status-danger)_12%,transparent)] text-[color:color-mix(in_srgb,var(--app-status-danger)_88%,var(--app-text-primary)_12%)]";
    case "hunk":
      return "border-[color:color-mix(in_srgb,var(--app-status-warning)_52%,transparent)] bg-[color:color-mix(in_srgb,var(--app-status-warning)_10%,transparent)] text-[color:color-mix(in_srgb,var(--app-status-warning)_84%,var(--app-text-primary)_16%)]";
    case "header":
      return "border-[color:color-mix(in_srgb,var(--app-border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_52%,transparent)] text-[var(--app-text-primary)]";
    case "context":
      return "border-transparent text-[var(--app-text-secondary)]";
    default:
      return "border-transparent text-[var(--app-text-secondary)]";
  }
}

export function UnifiedDiffBlock({ diff }: { diff: string }) {
  return (
    <pre
      className={`${getDebugPreClass("surface").replace(
        "mt-2 ",
        ""
      )} overflow-hidden px-0 py-2`}
    >
      {diff.split("\n").map((line, index) => {
        const tone = getUnifiedDiffLineTone(line);
        return (
          <span
            key={`${index}:${line}`}
            className={`block min-h-6 border-l-2 px-3 ${getUnifiedDiffLineClass(
              tone
            )}`}
          >
            {line.length > 0 ? line : "\u00A0"}
          </span>
        );
      })}
    </pre>
  );
}

export function DiffCollapseButton({
  onClick,
  ariaLabel = "收起 diff"
}: {
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="mt-2 w-full rounded-[var(--app-radius-md)] border border-[color:color-mix(in_srgb,var(--app-border-subtle)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--app-bg-surface)_68%,transparent)] px-3 py-2 text-xs font-medium text-[var(--app-text-secondary)] transition hover:border-[var(--app-border-accent)] hover:text-[var(--app-text-primary)]"
    >
      收起
    </button>
  );
}
