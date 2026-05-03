import { z } from "zod";

import { THINKING_EFFORT_OPTIONS } from "./session-context.js";

const hhmmPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const CRON_JOB_STATUS_OPTIONS = [
  "active",
  "paused",
  "completed"
] as const;
export const CRON_SCHEDULE_MODE_OPTIONS = ["interval", "weekly"] as const;
export const CRON_INTERVAL_UNIT_OPTIONS = ["minute", "hour", "day"] as const;
export const CRON_WEEKDAY_OPTIONS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;

export type CronJobStatus = (typeof CRON_JOB_STATUS_OPTIONS)[number];
export type CronScheduleMode = (typeof CRON_SCHEDULE_MODE_OPTIONS)[number];
export type CronIntervalUnit = (typeof CRON_INTERVAL_UNIT_OPTIONS)[number];
export type CronWeekday = (typeof CRON_WEEKDAY_OPTIONS)[number];

function hasDefinedField(
  value: Record<string, unknown>,
  fieldNames: readonly string[]
): boolean {
  return fieldNames.some(
    (fieldName) => typeof value[fieldName] !== "undefined"
  );
}

export function isValidCronTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
}

export function normalizeCronTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("startsAt must be a valid datetime string.");
  }
  return parsed.toISOString();
}

export function normalizeCronTimeOfDay(value: string): string {
  const normalized = value.trim();
  if (!hhmmPattern.test(normalized)) {
    throw new Error("timeOfDay must be a valid HH:mm string.");
  }
  return normalized;
}

function createCronBaseSchema() {
  return {
    name: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    workingDirectory: z.string().trim().min(1),
    startsAt: z
      .string()
      .trim()
      .min(1)
      .refine(isValidCronTimestamp, "startsAt must be a valid datetime string."),
    maxRuns: z.number().int().min(1).nullable().optional(),
    model: z.string().trim().min(1).optional(),
    thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
    status: z.enum(CRON_JOB_STATUS_OPTIONS).optional()
  } as const;
}

const createCronBaseShape = createCronBaseSchema();
const updateCronBaseShape = {
  name: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
  workingDirectory: z.string().trim().min(1).optional(),
  startsAt: z
    .string()
    .trim()
    .min(1)
    .refine(isValidCronTimestamp, "startsAt must be a valid datetime string.")
    .optional(),
  maxRuns: z.number().int().min(1).nullable().optional(),
  model: z.string().trim().min(1).nullable().optional(),
  thinkingEffort: z.enum(THINKING_EFFORT_OPTIONS).nullable().optional(),
  status: z.enum(CRON_JOB_STATUS_OPTIONS).optional()
} as const;

export const createCronJobPayloadSchema = z.discriminatedUnion(
  "scheduleMode",
  [
    z.strictObject({
      ...createCronBaseShape,
      scheduleMode: z.literal("interval"),
      intervalUnit: z.enum(CRON_INTERVAL_UNIT_OPTIONS),
      intervalValue: z.number().int().min(1)
    }),
    z.strictObject({
      ...createCronBaseShape,
      scheduleMode: z.literal("weekly"),
      weekday: z.enum(CRON_WEEKDAY_OPTIONS),
      timeOfDay: z
        .string()
        .trim()
        .regex(hhmmPattern, "timeOfDay must be a valid HH:mm string.")
    })
  ]
);

const updateCronJobCommonOnlySchema = z
  .strictObject(updateCronBaseShape)
  .refine(
    (value) =>
      hasDefinedField(value as Record<string, unknown>, [
        "name",
        "prompt",
        "workingDirectory",
        "startsAt",
        "maxRuns",
        "model",
        "thinkingEffort",
        "status"
      ]),
    { message: "At least one cron job field is required." }
  );

export const updateCronJobPayloadSchema = z.union([
  updateCronJobCommonOnlySchema,
  z.strictObject({
    ...updateCronBaseShape,
    scheduleMode: z.literal("interval"),
    intervalUnit: z.enum(CRON_INTERVAL_UNIT_OPTIONS),
    intervalValue: z.number().int().min(1)
  }),
  z.strictObject({
    ...updateCronBaseShape,
    scheduleMode: z.literal("weekly"),
    weekday: z.enum(CRON_WEEKDAY_OPTIONS),
    timeOfDay: z
      .string()
      .trim()
      .regex(hhmmPattern, "timeOfDay must be a valid HH:mm string.")
  })
]);

const cronJobRecordBaseShape = {
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  workingDirectory: z.string().min(1),
  startsAt: z.string().min(1),
  nextRunAt: z.string().min(1).nullable(),
  maxRuns: z.number().int().min(1).nullable(),
  runCount: z.number().int().min(0),
  remainingRuns: z.number().int().min(0).nullable(),
  status: z.enum(CRON_JOB_STATUS_OPTIONS),
  modelOverride: z.string().min(1).nullable(),
  thinkingEffortOverride: z
    .enum(THINKING_EFFORT_OPTIONS)
    .nullable(),
  lastRunAt: z.string().min(1).nullable(),
  latestRunSessionId: z.string().min(1).nullable(),
  latestRunStatus: z.string().min(1).nullable(),
  lastError: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
} as const;

export const cronJobRecordSchema = z.discriminatedUnion("scheduleMode", [
  z.strictObject({
    ...cronJobRecordBaseShape,
    scheduleMode: z.literal("interval"),
    intervalUnit: z.enum(CRON_INTERVAL_UNIT_OPTIONS),
    intervalValue: z.number().int().min(1),
    weekday: z.null(),
    timeOfDay: z.null()
  }),
  z.strictObject({
    ...cronJobRecordBaseShape,
    scheduleMode: z.literal("weekly"),
    intervalUnit: z.null(),
    intervalValue: z.null(),
    weekday: z.enum(CRON_WEEKDAY_OPTIONS),
    timeOfDay: z.string().regex(hhmmPattern)
  })
]);

export const listCronJobsResultSchema = z.strictObject({
  cronJobs: z.array(cronJobRecordSchema)
});

export const cronJobPayloadSchema = z.strictObject({
  cronJob: cronJobRecordSchema
});

export type CreateCronJobPayload = z.infer<typeof createCronJobPayloadSchema>;
export type UpdateCronJobPayload = z.infer<typeof updateCronJobPayloadSchema>;
export type CronJobRecord = z.infer<typeof cronJobRecordSchema>;
export type ListCronJobsResult = z.infer<typeof listCronJobsResultSchema>;
export type CronJobPayload = z.infer<typeof cronJobPayloadSchema>;

export function addCronInterval(
  date: Date,
  unit: CronIntervalUnit,
  count: number
): Date {
  const next = new Date(date);
  if (unit === "minute") {
    next.setMinutes(next.getMinutes() + count);
    return next;
  }
  if (unit === "hour") {
    next.setHours(next.getHours() + count);
    return next;
  }
  next.setDate(next.getDate() + count);
  return next;
}

function resolveWeekdayIndex(weekday: CronWeekday): number {
  switch (weekday) {
    case "monday":
      return 1;
    case "tuesday":
      return 2;
    case "wednesday":
      return 3;
    case "thursday":
      return 4;
    case "friday":
      return 5;
    case "saturday":
      return 6;
    case "sunday":
      return 0;
  }
}

function resolveWeeklyOccurrenceOnOrAfter(input: {
  startsAt: string;
  weekday: CronWeekday;
  timeOfDay: string;
}): Date {
  const startDate = new Date(normalizeCronTimestamp(input.startsAt));
  const [hours, minutes] = normalizeCronTimeOfDay(input.timeOfDay)
    .split(":")
    .map(Number);
  const candidate = new Date(startDate);
  candidate.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  let deltaDays = (resolveWeekdayIndex(input.weekday) - candidate.getDay() + 7) % 7;
  if (deltaDays === 0 && candidate.getTime() < startDate.getTime()) {
    deltaDays = 7;
  }
  candidate.setDate(candidate.getDate() + deltaDays);
  return candidate;
}

export function resolveCronJobScheduledRunAt(input: {
  scheduleMode: CronScheduleMode;
  startsAt: string;
  intervalUnit?: CronIntervalUnit | null;
  intervalValue?: number | null;
  weekday?: CronWeekday | null;
  timeOfDay?: string | null;
  runIndex: number;
}): string {
  const runIndex = Math.max(0, Math.floor(input.runIndex));
  if (input.scheduleMode === "interval") {
    if (
      !input.intervalUnit ||
      typeof input.intervalValue !== "number" ||
      !Number.isInteger(input.intervalValue) ||
      input.intervalValue < 1
    ) {
      throw new Error("Interval cron jobs require intervalUnit and intervalValue.");
    }
    const startDate = new Date(normalizeCronTimestamp(input.startsAt));
    return addCronInterval(
      startDate,
      input.intervalUnit,
      input.intervalValue * runIndex
    ).toISOString();
  }

  if (!input.weekday || !input.timeOfDay) {
    throw new Error("Weekly cron jobs require weekday and timeOfDay.");
  }

  const firstOccurrence = resolveWeeklyOccurrenceOnOrAfter({
    startsAt: input.startsAt,
    weekday: input.weekday,
    timeOfDay: input.timeOfDay
  });
  const next = new Date(firstOccurrence);
  next.setDate(next.getDate() + 7 * runIndex);
  return next.toISOString();
}

export function resolveCronJobNextRunAt(input: {
  scheduleMode: CronScheduleMode;
  startsAt: string;
  intervalUnit?: CronIntervalUnit | null;
  intervalValue?: number | null;
  weekday?: CronWeekday | null;
  timeOfDay?: string | null;
  runCount: number;
  maxRuns: number | null;
  status?: CronJobStatus;
}): string | null {
  if (
    (typeof input.maxRuns === "number" && input.runCount >= input.maxRuns) ||
    input.status === "completed"
  ) {
    return null;
  }

  return resolveCronJobScheduledRunAt({
    scheduleMode: input.scheduleMode,
    startsAt: input.startsAt,
    intervalUnit: input.intervalUnit ?? null,
    intervalValue: input.intervalValue ?? null,
    weekday: input.weekday ?? null,
    timeOfDay: input.timeOfDay ?? null,
    runIndex: input.runCount
  });
}

export function resolveCronJobRemainingRuns(input: {
  maxRuns: number | null;
  runCount: number;
}): number | null {
  if (typeof input.maxRuns !== "number") {
    return null;
  }
  return Math.max(0, input.maxRuns - input.runCount);
}

export function resolveCronJobStatusAfterRun(input: {
  runCount: number;
  maxRuns: number | null;
  statusWhenRunnable: Extract<CronJobStatus, "active" | "paused">;
}): CronJobStatus {
  if (
    typeof input.maxRuns === "number" &&
    input.runCount >= input.maxRuns
  ) {
    return "completed";
  }
  return input.statusWhenRunnable;
}
