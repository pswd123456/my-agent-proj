export type RoutineStatus = "active" | "deleted";
export type RoutineSource = "user_confirmed" | "agent_suggested_confirmed";

export interface RoutineRecord {
  id: string;
  name: string;
  description: string | null;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  startAt: string;
  endAt: string;
  status: RoutineStatus;
  source: RoutineSource;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineConflict {
  routine: RoutineRecord;
  previewText: string;
}

export interface RoutineTimingInput {
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
}

export interface RoutineTiming {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  startAt: string;
  endAt: string;
  spansNextDay: boolean;
}

export interface RoutineTimingUpdatePatch {
  date?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  durationMinutes?: number | undefined;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    typeof day !== "number"
  ) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function isValidTimeString(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function parseDateParts(value: string): {
  year: number;
  monthIndex: number;
  day: number;
} {
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    typeof day !== "number"
  ) {
    throw new Error("Invalid date string.");
  }
  return {
    year,
    monthIndex: month - 1,
    day
  };
}

export function buildLocalDate(date: string, time: string): Date {
  const { year, monthIndex, day } = parseDateParts(date);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, monthIndex, day, hours, minutes, 0, 0);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDate(value: Date): string {
  return [
    String(value.getFullYear()),
    pad(value.getMonth() + 1),
    pad(value.getDate())
  ].join("-");
}

export function formatTime(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function formatTimestamp(value: Date): string {
  return `${formatDate(value)} ${formatTime(value)}:00`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function resolveRoutineTiming(input: RoutineTimingInput): RoutineTiming {
  if (!isValidDateString(input.date)) {
    throw new Error("date must be a valid YYYY-MM-DD string.");
  }

  if (!isValidTimeString(input.startTime)) {
    throw new Error("startTime must be a valid HH:mm string.");
  }

  if (
    typeof input.durationMinutes !== "undefined" &&
    (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0)
  ) {
    throw new Error("durationMinutes must be a positive integer.");
  }

  if (
    typeof input.endTime !== "undefined" &&
    !isValidTimeString(input.endTime)
  ) {
    throw new Error("endTime must be a valid HH:mm string.");
  }

  const startAtDate = buildLocalDate(input.date, input.startTime);
  let endAtDate: Date;

  if (typeof input.endTime === "string") {
    endAtDate = buildLocalDate(input.date, input.endTime);
    if (endAtDate.getTime() <= startAtDate.getTime()) {
      endAtDate = addMinutes(endAtDate, 24 * 60);
    }
  } else {
    endAtDate = addMinutes(startAtDate, input.durationMinutes ?? 60);
  }

  const durationMinutes = Math.round(
    (endAtDate.getTime() - startAtDate.getTime()) / 60_000
  );

  if (durationMinutes <= 0) {
    throw new Error("endTime must be later than startTime.");
  }

  if (
    typeof input.durationMinutes === "number" &&
    input.durationMinutes !== durationMinutes
  ) {
    throw new Error("durationMinutes does not match the provided time range.");
  }

  return {
    date: input.date,
    startTime: input.startTime,
    endTime: formatTime(endAtDate),
    durationMinutes,
    startAt: formatTimestamp(startAtDate),
    endAt: formatTimestamp(endAtDate),
    spansNextDay: formatDate(endAtDate) !== input.date
  };
}

export function mergeRoutineTimingForUpdate(
  existing: Pick<
    RoutineRecord,
    "date" | "startTime" | "endTime" | "durationMinutes"
  >,
  patch: RoutineTimingUpdatePatch
): RoutineTimingInput {
  const next: RoutineTimingInput = {
    date: patch.date ?? existing.date,
    startTime: patch.startTime ?? existing.startTime
  };

  if (typeof patch.durationMinutes === "number") {
    next.durationMinutes = patch.durationMinutes;
    if (typeof patch.endTime === "string") {
      next.endTime = patch.endTime;
    }
    return next;
  }

  if (typeof patch.endTime === "string") {
    next.endTime = patch.endTime;
    return next;
  }

  if (typeof patch.startTime === "string") {
    next.durationMinutes = existing.durationMinutes;
    return next;
  }

  next.endTime = existing.endTime;
  return next;
}

export function doIntervalsOverlap(
  left: Pick<RoutineRecord, "startAt" | "endAt">,
  right: Pick<RoutineRecord, "startAt" | "endAt">
): boolean {
  return left.startAt < right.endAt && left.endAt > right.startAt;
}

export function sortRoutinesByStartAt<T extends Pick<RoutineRecord, "startAt">>(
  routines: T[]
): T[] {
  return [...routines].sort((left, right) =>
    left.startAt.localeCompare(right.startAt)
  );
}

export function formatRoutinePreview(
  routine: Pick<RoutineRecord, "date" | "startTime" | "endTime" | "name">
): string {
  return `${routine.date} ${routine.startTime}-${routine.endTime} ${routine.name}`;
}

export function formatRoutinePreviewWithDescription(
  routine: Pick<
    RoutineRecord,
    "date" | "startTime" | "endTime" | "name" | "description"
  >
): string {
  const base = formatRoutinePreview(routine);
  return routine.description ? `${base} (${routine.description})` : base;
}
