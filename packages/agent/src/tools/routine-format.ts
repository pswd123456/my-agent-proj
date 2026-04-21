import type { RoutineConflict, RoutineRecord } from "@ai-app-template/domain";

export function formatRoutineLine(
  routine: Pick<RoutineRecord, "date" | "startTime" | "endTime" | "name">
): string {
  return `- ${routine.date} ${routine.startTime}-${routine.endTime} ${routine.name}`;
}

export function formatRoutineLines(
  routines: Array<Pick<RoutineRecord, "date" | "startTime" | "endTime" | "name">>
): string {
  return routines.map(formatRoutineLine).join("\n");
}

export function formatConflictLines(conflicts: RoutineConflict[]): string {
  return conflicts
    .map((conflict) => `- existing: ${conflict.previewText}`)
    .join("\n");
}
