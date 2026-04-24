"use client";

import { useMemo, useState } from "react";

import type { RunStreamEvent } from "@ai-app-template/sdk";

import type { ToolRow } from "./session-workbench-state";
import { getTimelineEventRenderKey } from "./session-timeline";
import { type InspectorTabId, inspectorTabs } from "./session-workbench-types";
import {
  buildPromptMessageSections,
  formatTimestamp,
  getDebugPreClass,
  getInspectorCardClass,
  getPermissionDecisionLabel,
  getSoftBlockClass,
  stringify
} from "./session-workbench-shared";

type PromptEvent = Extract<RunStreamEvent, { kind: "prompt" }>;
type ThinkingEvent = Extract<RunStreamEvent, { kind: "thinking" }>;

interface SessionWorkbenchInspectorProps {
  activeTab: InspectorTabId;
  inspectorEvents: RunStreamEvent[];
  latestPromptEvent: PromptEvent | undefined;
  thinkingEvents: ThinkingEvent[];
  toolRows: ToolRow[];
  promptEvents: PromptEvent[];
  onSelectTab: (tabId: InspectorTabId) => void;
}

function EmptyInspectorState({ message }: { message: string }) {
  return (
    <div className={getSoftBlockClass("py-6 text-sm text-[var(--app-text-muted)]")}>
      {message}
    </div>
  );
}

function InspectorDataBlock({
  label,
  value,
  tone = "muted"
}: {
  label: string;
  value: string;
  tone?: "muted" | "surface";
}) {
  return (
    <div className={getSoftBlockClass("px-3 py-3")}>
      <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
        {label}
      </p>
      <pre className={getDebugPreClass(tone)}>{value}</pre>
    </div>
  );
}

function PromptMessagesPanel({ promptEvents }: { promptEvents: PromptEvent[] }) {
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(() => new Set());
  const sections = useMemo(
    () => buildPromptMessageSections(promptEvents),
    [promptEvents]
  );

  if (!sections.length) {
    return <EmptyInspectorState message="暂无 messages 事件。" />;
  }

  return (
    <div className="grid min-w-0 gap-3">
      {sections.map((section) => {
        const expanded = expandedTurns.has(section.turnCount);
        return (
          <article
            key={`prompt-messages-${section.turnCount}`}
            className={getInspectorCardClass()}
          >
            <button
              type="button"
              onClick={() => {
                setExpandedTurns((current) => {
                  const next = new Set(current);
                  if (next.has(section.turnCount)) {
                    next.delete(section.turnCount);
                  } else {
                    next.add(section.turnCount);
                  }
                  return next;
                });
              }}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  Turn {section.turnCount}
                </div>
                <div className="mt-2 text-sm text-[var(--app-text-secondary)]">
                  {formatTimestamp(section.createdAt)}
                </div>
                <div className="mt-2 text-xs leading-6 text-[var(--app-text-muted)]">
                  {section.summary}
                </div>
              </div>
              <div className="shrink-0 rounded-[var(--app-radius-pill)] border border-[var(--app-border-subtle)] px-3 py-1 text-[0.68rem] uppercase tracking-[0.14em] text-[var(--app-text-muted)]">
                {expanded ? "Hide" : "Show"}
              </div>
            </button>

            {expanded ? (
              <div className="mt-4 grid gap-3">
                {section.mode === "full" ? (
                  <InspectorDataBlock
                    label="Full Context"
                    tone="surface"
                    value={section.fullText}
                  />
                ) : (
                  <>
                    <InspectorDataBlock
                      label="Added Lines"
                      tone="surface"
                      value={section.addedText}
                    />
                    <InspectorDataBlock
                      label="Removed Lines"
                      tone="surface"
                      value={section.removedText}
                    />
                  </>
                )}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function PromptTabPanel({ latestPromptEvent }: { latestPromptEvent: PromptEvent | undefined }) {
  if (!latestPromptEvent) {
    return <EmptyInspectorState message="暂无 prompt 事件。" />;
  }

  return (
    <div className="grid min-w-0 gap-3">
      <InspectorDataBlock value={stringify(latestPromptEvent.system)} label="System" />
      <InspectorDataBlock
        value={stringify(latestPromptEvent.prefixMessages ?? [])}
        label="Prefix Messages"
      />
      <InspectorDataBlock value={stringify(latestPromptEvent.messages)} label="Messages" />
      <InspectorDataBlock
        value={stringify(latestPromptEvent.runtimeContextMessages ?? [])}
        label="Runtime Context"
      />
      <InspectorDataBlock
        value={stringify({
          cacheKey: latestPromptEvent.cacheKey,
          toolChoice: latestPromptEvent.toolChoice,
          tools: latestPromptEvent.tools
        })}
        label="Metadata"
      />
    </div>
  );
}

function ThinkingTabPanel({ thinkingEvents }: { thinkingEvents: ThinkingEvent[] }) {
  if (!thinkingEvents.length) {
    return <EmptyInspectorState message="暂无 thinking 事件。" />;
  }

  return (
    <div className="grid min-w-0 gap-3">
      {thinkingEvents.map((event, index) => (
        <article
          key={`${event.createdAt}-${index}`}
          className={getInspectorCardClass()}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                Thinking
              </div>
              <div className="mt-2 text-sm text-[var(--app-text-secondary)]">
                {formatTimestamp(event.createdAt)}
              </div>
            </div>
            <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              signed
            </div>
          </div>
          <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
            {event.text || "(empty)"}
          </pre>
        </article>
      ))}
    </div>
  );
}

function ToolTabPanel({ toolRows }: { toolRows: ToolRow[] }) {
  if (!toolRows.length) {
    return <EmptyInspectorState message="暂无工具事件。" />;
  }

  return (
    <div className="grid min-w-0 gap-3">
      {toolRows.map((row) => (
        <article key={row.toolCallId} className={getInspectorCardClass()}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="break-all text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                {row.toolCallId}
              </div>
              <div className="mt-2 text-sm font-medium text-[var(--app-text-primary)]">
                {row.toolName}
              </div>
            </div>
            <div
              className={`text-xs ${
                row.isError
                  ? "text-[var(--app-status-danger)]"
                  : "text-[var(--app-status-success)]"
              }`}
            >
              {row.isError ? "failed" : "ok"}
            </div>
          </div>
          <div className="mt-4 grid min-w-0 gap-3">
            <InspectorDataBlock
              label="Input"
              tone="surface"
              value={row.input ? stringify(row.input) : "null"}
            />
            <InspectorDataBlock
              label="Raw Output"
              tone="surface"
              value={row.output ?? "pending"}
            />
            <InspectorDataBlock
              label="Display Text"
              tone="surface"
              value={row.displayText ?? "pending"}
            />
            {(row.permissionDecision ||
              row.permissionSummary ||
              row.permissionReason) && (
              <InspectorDataBlock
                label="Permission"
                tone="surface"
                value={stringify({
                  decision: getPermissionDecisionLabel(row.permissionDecision),
                  family: row.permissionFamily,
                  permissionProfile: row.permissionProfile,
                  summary: row.permissionSummary,
                  contextNote: row.permissionContextNote,
                  reason: row.permissionReason
                })}
              />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function TraceTabPanel({ inspectorEvents }: { inspectorEvents: RunStreamEvent[] }) {
  if (!inspectorEvents.length) {
    return <EmptyInspectorState message="暂无 trace 事件。" />;
  }

  return (
    <div className="grid min-w-0 gap-2">
      {inspectorEvents.map((event) => (
        <div
          key={getTimelineEventRenderKey(event)}
          className="min-w-0 rounded-[var(--app-radius-md)] bg-[color:color-mix(in_srgb,var(--app-bg-muted)_78%,transparent)] px-3 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
              {event.kind}
            </div>
            <div className="text-[0.72rem] text-[var(--app-text-muted)]">
              {formatTimestamp(event.createdAt)}
            </div>
          </div>
          <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
            {stringify(event)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function renderInspectorTabPanel(props: SessionWorkbenchInspectorProps) {
  switch (props.activeTab) {
    case "prompt":
      return <PromptTabPanel latestPromptEvent={props.latestPromptEvent} />;
    case "messages":
      return <PromptMessagesPanel promptEvents={props.promptEvents} />;
    case "thinking":
      return <ThinkingTabPanel thinkingEvents={props.thinkingEvents} />;
    case "tools":
      return <ToolTabPanel toolRows={props.toolRows} />;
    case "trace":
      return <TraceTabPanel inspectorEvents={props.inspectorEvents} />;
    default:
      return null;
  }
}

export function SessionWorkbenchInspector(
  props: SessionWorkbenchInspectorProps
) {
  return (
    <div className="flex min-h-[24rem] min-w-0 flex-col">
      <div className="flex min-w-0 flex-wrap gap-2">
        {inspectorTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => props.onSelectTab(tab.id)}
            className={`rounded-[var(--app-radius-pill)] border px-3 py-1.5 text-xs font-medium transition ${
              props.activeTab === tab.id
                ? "border-[var(--app-border-accent)] bg-[var(--app-bg-elevated)] text-[var(--app-text-primary)]"
                : "border-[var(--app-border-subtle)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-secondary)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
        <div className="grid min-w-0 gap-3">{renderInspectorTabPanel(props)}</div>
      </div>
    </div>
  );
}
