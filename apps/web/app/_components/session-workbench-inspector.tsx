"use client";

import { useMemo, type ReactNode } from "react";

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
  stringify
} from "./session-workbench-shared";

type PromptEvent = Extract<RunStreamEvent, { kind: "prompt" }>;
type ThinkingEvent = Extract<RunStreamEvent, { kind: "thinking" }>;
type ResponseEvent = Extract<RunStreamEvent, { kind: "response" }>;
type RunErrorEvent = Extract<RunStreamEvent, { kind: "run_error" }>;

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
  return <div className="py-6 text-sm text-[var(--app-text-muted)]">{message}</div>;
}

function SectionTitle({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
        {label}
      </div>
      {meta ? <div className="text-[0.68rem] text-[var(--app-text-muted)]">{meta}</div> : null}
    </div>
  );
}

function FlatBlock({
  label,
  value,
  tone = "muted",
  collapsed = false,
  summary,
  meta
}: {
  label: string;
  value: string;
  tone?: "muted" | "surface";
  collapsed?: boolean;
  summary?: string;
  meta?: string;
}) {
  const shellClassName =
    "min-w-0 rounded-[var(--app-radius-md)] border border-[var(--app-border-subtle)] px-3 py-3";

  if (collapsed) {
    return (
      <details className={shellClassName}>
        <summary className="cursor-pointer list-none">
          <SectionTitle label={label} meta={summary ?? meta ?? "展开查看"} />
        </summary>
        <pre className={getDebugPreClass(tone).replace("mt-2 ", "mt-3 ")}>{value}</pre>
      </details>
    );
  }

  return (
    <div className={shellClassName}>
      <SectionTitle label={label} {...(meta ? { meta } : {})} />
      <pre className={getDebugPreClass(tone)}>{value}</pre>
    </div>
  );
}

function PlainCard({ children }: { children: ReactNode }) {
  return <article className={getInspectorCardClass()}>{children}</article>;
}

function summarizeText(value: string | null | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return fallback;
  }

  return compact.length > 140 ? `${compact.slice(0, 140)}…` : compact;
}

function shouldCollapseLongText(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  return value.length > 240 || value.includes("\n");
}

function getEventTurnCount(event: RunStreamEvent): number | null {
  return "turnCount" in event ? event.turnCount : null;
}

function getEventNarrativeOrder(event: RunStreamEvent): number {
  switch (event.kind) {
    case "turn_start":
      return 0;
    case "prompt":
      return 1;
    case "thinking":
      return 2;
    case "tool_call":
      return 3;
    case "permission_request":
      return 4;
    case "permission_approved":
    case "permission_rejected":
    case "permission_blocked":
      return 5;
    case "tool_result":
      return 6;
    case "response":
      return 7;
    case "assistant_text":
      return 8;
    case "fallback":
      return 9;
    case "run_error":
      return 10;
    case "run_complete":
      return 11;
    case "turn_end":
      return 12;
    default:
      return 99;
  }
}

function sortEventsForNarrative(events: RunStreamEvent[]): RunStreamEvent[] {
  return [...events].sort((left, right) => {
    const leftTurn = getEventTurnCount(left);
    const rightTurn = getEventTurnCount(right);

    if (leftTurn !== null && rightTurn !== null && leftTurn !== rightTurn) {
      return leftTurn - rightTurn;
    }

    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }

    return getEventNarrativeOrder(left) - getEventNarrativeOrder(right);
  });
}

function PromptMessagesPanel({ promptEvents }: { promptEvents: PromptEvent[] }) {
  const sections = useMemo(() => buildPromptMessageSections(promptEvents), [promptEvents]);

  if (!sections.length) {
    return <EmptyInspectorState message="暂无 messages 事件。" />;
  }

  return (
    <div className="grid min-w-0 gap-3">
      {sections.map((section) => (
        <PlainCard key={`prompt-messages-${section.turnCount}`}>
          <SectionTitle
            label={`Turn ${section.turnCount}`}
            meta={`${formatTimestamp(section.createdAt)} · ${section.mode === "full" ? "full" : "diff"}`}
          />
          <div className="mt-3 text-sm leading-6 text-[var(--app-text-primary)]">
            {section.summary}
          </div>
          <div className="mt-3 grid gap-3">
            {section.mode === "full" ? (
              <FlatBlock
                label="Full Context"
                tone="surface"
                collapsed={shouldCollapseLongText(section.fullText)}
                summary={summarizeText(section.fullText, "展开查看完整上下文")}
                value={section.fullText}
              />
            ) : (
              <>
                <FlatBlock
                  label="Added Lines"
                  tone="surface"
                  collapsed={shouldCollapseLongText(section.addedText)}
                  summary={summarizeText(section.addedText, "展开查看新增内容")}
                  value={section.addedText}
                />
                <FlatBlock
                  label="Removed Lines"
                  tone="surface"
                  collapsed={shouldCollapseLongText(section.removedText)}
                  summary={summarizeText(section.removedText, "展开查看移除内容")}
                  value={section.removedText}
                />
              </>
            )}
          </div>
        </PlainCard>
      ))}
    </div>
  );
}

function PromptTabPanel({ latestPromptEvent }: { latestPromptEvent: PromptEvent | undefined }) {
  if (!latestPromptEvent) {
    return <EmptyInspectorState message="暂无 prompt 事件。" />;
  }

  return (
    <div className="grid min-w-0 gap-3">
      <PlainCard>
        <SectionTitle label="Prompt Envelope" />
        <div className="mt-3 grid gap-3">
          <FlatBlock
            label="System"
            tone="surface"
            value={stringify(latestPromptEvent.system)}
          />
          <FlatBlock
            label="Metadata"
            tone="surface"
            value={stringify({
              cacheKey: latestPromptEvent.cacheKey,
              toolChoice: latestPromptEvent.toolChoice,
              toolCount: latestPromptEvent.tools.length,
              prefixMessageCount: latestPromptEvent.prefixMessages?.length ?? 0,
              runtimeContextCount: latestPromptEvent.runtimeContextMessages?.length ?? 0,
              conversationMessageCount: latestPromptEvent.messages.length
            })}
          />
        </div>
      </PlainCard>
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
        <PlainCard key={`${event.createdAt}-${index}`}>
          <SectionTitle
            label={`Turn ${event.turnCount}`}
            meta={`${formatTimestamp(event.createdAt)} · signature ${event.signature}`}
          />
          <div className="mt-3">
            <FlatBlock label="Thinking" tone="surface" collapsed={false} value={event.text || "(empty)"} />
          </div>
        </PlainCard>
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
      {toolRows.map((row) => {
        const statusLabel = row.output === null ? "pending" : row.isError ? "failed" : "ok";
        const statusToneClass =
          statusLabel === "failed"
            ? "text-[var(--app-status-danger)]"
            : statusLabel === "pending"
              ? "text-[var(--app-status-warning)]"
              : "text-[var(--app-status-success)]";
        const headerMeta = [
          row.turnCount !== null ? `Turn ${row.turnCount}` : null,
          formatTimestamp(row.createdAt),
          statusLabel
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <PlainCard key={row.toolCallId}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <SectionTitle label={row.toolName} meta={headerMeta} />
                <div className="mt-2 break-all font-mono text-[0.72rem] text-[var(--app-text-muted)]">
                  {row.toolCallId}
                </div>
              </div>
              <div className={`text-xs uppercase tracking-[0.14em] ${statusToneClass}`}>{statusLabel}</div>
            </div>

            <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
              <FlatBlock
                label="Input"
                tone="surface"
                collapsed={shouldCollapseLongText(row.input ? stringify(row.input) : "null")}
                summary={summarizeText(row.input ? stringify(row.input) : "null", "展开查看输入")}
                value={row.input ? stringify(row.input) : "null"}
              />
              {(row.permissionDecision ||
                row.permissionSummary ||
                row.permissionReason ||
                row.permissionFamily ||
                row.permissionProfile ||
                row.permissionContextNote) && (
                <FlatBlock
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
              {row.displayText ? (
                <FlatBlock
                  label="Display Text"
                  tone="surface"
                  collapsed={shouldCollapseLongText(row.displayText)}
                  summary={summarizeText(row.displayText, "展开查看展示文本")}
                  value={row.displayText}
                />
              ) : null}
              <FlatBlock
                label="Raw Output"
                tone="surface"
                collapsed
                summary={summarizeText(row.output, row.output === null ? "pending" : "展开查看原始输出")}
                value={row.output ?? "pending"}
              />
            </div>
          </PlainCard>
        );
      })}
    </div>
  );
}

function TraceTabPanel({ inspectorEvents }: { inspectorEvents: RunStreamEvent[] }) {
  if (!inspectorEvents.length) {
    return <EmptyInspectorState message="暂无 trace 事件。" />;
  }

  const latestRunError = [...inspectorEvents]
    .reverse()
    .find((event): event is RunErrorEvent => event.kind === "run_error");
  const latestTurn = Math.max(...inspectorEvents.map((event) => getEventTurnCount(event) ?? 0));
  const latestTurnEvents = sortEventsForNarrative(
    inspectorEvents.filter((event) => getEventTurnCount(event) === latestTurn)
  );
  const responseEvents = inspectorEvents.filter(
    (event): event is ResponseEvent => event.kind === "response"
  );

  return (
    <div className="grid min-w-0 gap-3">
      {latestRunError ? (() => {
        const latestRunErrorTurnCount =
          "turnCount" in latestRunError ? latestRunError.turnCount : null;
        const latestRunErrorLoopState =
          "loopState" in latestRunError ? latestRunError.loopState : latestRunError.status;
        const latestRunErrorContextStatus =
          "contextStatus" in latestRunError
            ? latestRunError.contextStatus
            : (latestRunError.session?.context.status ?? "unknown");
        const latestRunErrorPendingToolCallIds =
          "pendingToolCallIds" in latestRunError
            ? latestRunError.pendingToolCallIds
            : (latestRunError.session?.sessionState.pendingToolCallIds ?? []);

        return (
          <PlainCard>
            <SectionTitle
              label="Latest Run Error"
              meta={`${formatTimestamp(latestRunError.createdAt)} · Turn ${latestRunErrorTurnCount ?? "--"}`}
            />
            <div className="mt-3 text-sm leading-6 text-[var(--app-text-primary)]">
              {latestRunError.error}
            </div>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <FlatBlock
                label="Context"
                tone="surface"
                value={stringify({
                  stopReason: latestRunError.stopReason,
                  loopState: latestRunErrorLoopState,
                  contextStatus: latestRunErrorContextStatus,
                  pendingToolCallIds: latestRunErrorPendingToolCallIds
                })}
              />
              {"session" in latestRunError && latestRunError.session ? (
                <FlatBlock
                  label="Session Snapshot"
                  tone="surface"
                  collapsed
                  summary="展开查看失败时会话快照"
                  value={stringify(latestRunError.session)}
                />
              ) : null}
            </div>
          </PlainCard>
        );
      })() : null}

      <PlainCard>
        <SectionTitle
          label="Latest Turn Narrative"
          meta={`Turn ${latestTurn} · ${latestTurnEvents.length} events · ${responseEvents.length} responses in trace`}
        />
        <div className="mt-3 grid min-w-0 gap-2">
          {latestTurnEvents.map((event) => (
            <details
              key={getTimelineEventRenderKey(event)}
              className="min-w-0 rounded-[var(--app-radius-md)] border border-[var(--app-border-subtle)] px-3 py-3"
            >
              <summary className="cursor-pointer list-none">
                <SectionTitle
                  label={event.kind}
                  meta={`${formatTimestamp(event.createdAt)} · ${
                    getEventTurnCount(event) !== null ? `Turn ${getEventTurnCount(event)}` : "session"
                  }`}
                />
              </summary>
              <pre className={getDebugPreClass("surface").replace("mt-2 ", "mt-3 ")}>
                {stringify(event)}
              </pre>
            </details>
          ))}
        </div>
      </PlainCard>
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

export function SessionWorkbenchInspector(props: SessionWorkbenchInspectorProps) {
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
