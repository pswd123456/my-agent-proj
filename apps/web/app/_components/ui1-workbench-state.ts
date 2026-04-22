import type {
  RoutineRecord,
  RunStreamEvent,
  SessionSnapshot,
  SessionSummary,
  TraceRecord
} from "@ai-app-template/sdk";

export function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateString(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export function buildWeekRange(anchorDate: string): {
  startDate: string;
  endDate: string;
  dates: string[];
} {
  const anchor = parseDateString(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() + mondayOffset);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const value = new Date(start);
    value.setDate(start.getDate() + index);
    return formatLocalDate(value);
  });
  return {
    startDate: dates[0] ?? anchorDate,
    endDate: dates[6] ?? anchorDate,
    dates
  };
}

export function mergeSessionSummary(
  sessions: SessionSummary[],
  session: SessionSnapshot,
  toSummary: (session: SessionSnapshot) => SessionSummary
): SessionSummary[] {
  const next = sessions.filter((item) => item.sessionId !== session.sessionId);
  next.unshift(toSummary(session));
  return next.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function flattenTraceRecords(records: TraceRecord[]): RunStreamEvent[] {
  return records.map((record) => ({
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    ...record.event
  })) as RunStreamEvent[];
}

export function collectToolRows(events: RunStreamEvent[]) {
  const rows: Array<{
    toolCallId: string;
    toolName: string;
    createdAt: string;
    input: Record<string, unknown> | null;
    output: string | null;
    displayText: string | null;
    isError: boolean;
    permissionFamily: string | null;
    permissionProfile: string | null;
    permissionSummary: string | null;
    permissionContextNote: string | null;
    permissionDecision:
      | "requested"
      | "approved"
      | "rejected"
      | "blocked"
      | null;
    permissionReason: string | null;
  }> = [];

  for (const event of events) {
    if (event.kind === "tool_call") {
      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: event.input,
        output: null,
        displayText: null,
        isError: false,
        permissionFamily: null,
        permissionProfile: null,
        permissionSummary: null,
        permissionContextNote: null,
        permissionDecision: null,
        permissionReason: null
      });
      continue;
    }

    if (event.kind === "permission_request") {
      const existing = rows.find((row) => row.toolCallId === event.toolCallId);
      if (existing) {
        existing.permissionFamily = event.request.family;
        existing.permissionProfile = event.request.permissionProfile;
        existing.permissionSummary = event.request.summaryText;
        existing.permissionContextNote = event.request.contextNote ?? null;
        existing.permissionDecision = "requested";
        continue;
      }

      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: null,
        output: null,
        displayText: null,
        isError: false,
        permissionFamily: event.request.family,
        permissionProfile: event.request.permissionProfile,
        permissionSummary: event.request.summaryText,
        permissionContextNote: event.request.contextNote ?? null,
        permissionDecision: "requested",
        permissionReason: null
      });
      continue;
    }

    if (
      event.kind === "permission_approved" ||
      event.kind === "permission_rejected"
    ) {
      const existing = rows.find((row) => row.toolCallId === event.toolCallId);
      if (existing) {
        existing.permissionFamily = event.request.family;
        existing.permissionProfile = event.request.permissionProfile;
        existing.permissionSummary = event.request.summaryText;
        existing.permissionContextNote = event.request.contextNote ?? null;
        existing.permissionDecision =
          event.kind === "permission_approved" ? "approved" : "rejected";
        continue;
      }

      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: null,
        output: null,
        displayText: null,
        isError: event.kind === "permission_rejected",
        permissionFamily: event.request.family,
        permissionProfile: event.request.permissionProfile,
        permissionSummary: event.request.summaryText,
        permissionContextNote: event.request.contextNote ?? null,
        permissionDecision:
          event.kind === "permission_approved" ? "approved" : "rejected",
        permissionReason: null
      });
      continue;
    }

    if (event.kind === "permission_blocked") {
      const existing = rows.find((row) => row.toolCallId === event.toolCallId);
      if (existing) {
        existing.permissionDecision = "blocked";
        existing.permissionReason = event.reason;
        existing.isError = true;
        continue;
      }

      rows.push({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        createdAt: event.createdAt,
        input: null,
        output: null,
        displayText: null,
        isError: true,
        permissionFamily: null,
        permissionProfile: null,
        permissionSummary: null,
        permissionContextNote: null,
        permissionDecision: "blocked",
        permissionReason: event.reason
      });
      continue;
    }

    if (event.kind !== "tool_result") {
      continue;
    }

    const existing = rows.find((row) => row.toolCallId === event.toolCallId);
    if (existing) {
      existing.output = event.output;
      existing.displayText = event.displayText ?? null;
      existing.isError = event.isError;
      continue;
    }

    rows.push({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      createdAt: event.createdAt,
      input: null,
      output: event.output,
      displayText: event.displayText ?? null,
      isError: event.isError,
      permissionFamily: null,
      permissionProfile: null,
      permissionSummary: null,
      permissionContextNote: null,
      permissionDecision: null,
      permissionReason: null
    });
  }

  return rows;
}

export function groupRoutinesByDate(
  routines: RoutineRecord[]
): Map<string, RoutineRecord[]> {
  const grouped = new Map<string, RoutineRecord[]>();
  for (const routine of routines) {
    const current = grouped.get(routine.date) ?? [];
    current.push(routine);
    current.sort((left, right) => left.startAt.localeCompare(right.startAt));
    grouped.set(routine.date, current);
  }
  return grouped;
}
