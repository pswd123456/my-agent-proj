import { z } from "zod";

import type {
  CreateCronJobPayload,
  CronJobRecord,
  DomainJsonValue,
  UpdateCronJobPayload
} from "@ai-app-template/domain";
import {
  CRON_INTERVAL_UNIT_OPTIONS,
  CRON_JOB_STATUS_OPTIONS,
  CRON_WEEKDAY_OPTIONS,
  THINKING_EFFORT_OPTIONS
} from "@ai-app-template/domain";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

const isoDateTimeSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Number.isFinite(new Date(value).getTime()), {
    message: "must be a valid datetime string"
  });

const hhmmSchema = z
  .string()
  .trim()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be a valid HH:mm string");

const listSchema = z
  .object({
    action: z.literal("list"),
    status: z.enum(CRON_JOB_STATUS_OPTIONS).optional()
  })
  .strict();

const createBaseSchema = {
  action: z.literal("create"),
  name: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  working_directory: z.string().trim().min(1).optional(),
  starts_at: isoDateTimeSchema,
  max_runs: z.number().int().min(1).nullable().optional(),
  model: z.string().trim().min(1).optional(),
  thinking_effort: z.enum(THINKING_EFFORT_OPTIONS).optional(),
  status: z.enum(CRON_JOB_STATUS_OPTIONS).optional()
} as const;

const createIntervalSchema = z
  .object({
    ...createBaseSchema,
    schedule_mode: z.literal("interval"),
    interval_unit: z.enum(CRON_INTERVAL_UNIT_OPTIONS),
    interval_value: z.number().int().min(1)
  })
  .strict();

const createWeeklySchema = z
  .object({
    ...createBaseSchema,
    schedule_mode: z.literal("weekly"),
    weekday: z.enum(CRON_WEEKDAY_OPTIONS),
    time_of_day: hhmmSchema
  })
  .strict();

const updateBaseSchema = {
  action: z.literal("update"),
  cron_job_id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
  working_directory: z.string().trim().min(1).optional(),
  starts_at: isoDateTimeSchema.optional(),
  max_runs: z.number().int().min(1).nullable().optional(),
  model: z.string().trim().min(1).nullable().optional(),
  thinking_effort: z.enum(THINKING_EFFORT_OPTIONS).nullable().optional(),
  status: z.enum(CRON_JOB_STATUS_OPTIONS).optional()
} as const;

const updateCommonSchema = z
  .object(updateBaseSchema)
  .strict()
  .refine(
    (value) =>
      [
        "name",
        "prompt",
        "working_directory",
        "starts_at",
        "max_runs",
        "model",
        "thinking_effort",
        "status"
      ].some(
        (fieldName) =>
          typeof value[fieldName as keyof typeof value] !== "undefined"
      ),
    { message: "At least one cron job field is required." }
  );

const updateIntervalSchema = z
  .object({
    ...updateBaseSchema,
    schedule_mode: z.literal("interval"),
    interval_unit: z.enum(CRON_INTERVAL_UNIT_OPTIONS),
    interval_value: z.number().int().min(1)
  })
  .strict();

const updateWeeklySchema = z
  .object({
    ...updateBaseSchema,
    schedule_mode: z.literal("weekly"),
    weekday: z.enum(CRON_WEEKDAY_OPTIONS),
    time_of_day: hhmmSchema
  })
  .strict();

const deleteSchema = z
  .object({
    action: z.literal("delete"),
    cron_job_id: z.string().trim().min(1)
  })
  .strict();

const schema = z.union([
  listSchema,
  createIntervalSchema,
  createWeeklySchema,
  updateCommonSchema,
  updateIntervalSchema,
  updateWeeklySchema,
  deleteSchema
]);

type ManageCronJobsInput = z.infer<typeof schema>;

function formatCronJobLine(job: CronJobRecord): string {
  const schedule =
    job.scheduleMode === "interval"
      ? `every ${job.intervalValue} ${job.intervalUnit}${job.intervalValue === 1 ? "" : "s"}`
      : `weekly ${job.weekday} ${job.timeOfDay}`;
  return `- ${job.id}: ${job.name} (${job.status}, ${schedule}, next: ${job.nextRunAt ?? "none"})`;
}

function formatCronJobDetails(job: CronJobRecord): string {
  return [
    formatCronJobLine(job),
    `  workingDirectory: ${job.workingDirectory}`,
    `  runCount: ${job.runCount}`,
    `  latestRunSessionId: ${job.latestRunSessionId ?? "none"}`
  ].join("\n");
}

function toCreatePayload(
  input: Extract<ManageCronJobsInput, { action: "create" }>,
  fallbackWorkingDirectory: string
): CreateCronJobPayload {
  const common = {
    name: input.name,
    prompt: input.prompt,
    workingDirectory: input.working_directory ?? fallbackWorkingDirectory,
    startsAt: input.starts_at,
    ...(typeof input.max_runs !== "undefined"
      ? { maxRuns: input.max_runs }
      : {}),
    ...(typeof input.model === "string" ? { model: input.model } : {}),
    ...(typeof input.thinking_effort === "string"
      ? { thinkingEffort: input.thinking_effort }
      : {}),
    ...(typeof input.status === "string" ? { status: input.status } : {})
  };

  if (input.schedule_mode === "interval") {
    return {
      ...common,
      scheduleMode: "interval",
      intervalUnit: input.interval_unit,
      intervalValue: input.interval_value
    };
  }

  return {
    ...common,
    scheduleMode: "weekly",
    weekday: input.weekday,
    timeOfDay: input.time_of_day
  };
}

function toUpdatePayload(
  input: Extract<ManageCronJobsInput, { action: "update" }>
): UpdateCronJobPayload {
  const common = {
    ...(typeof input.name === "string" ? { name: input.name } : {}),
    ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
    ...(typeof input.working_directory === "string"
      ? { workingDirectory: input.working_directory }
      : {}),
    ...(typeof input.starts_at === "string"
      ? { startsAt: input.starts_at }
      : {}),
    ...(typeof input.max_runs !== "undefined"
      ? { maxRuns: input.max_runs }
      : {}),
    ...(typeof input.model !== "undefined" ? { model: input.model } : {}),
    ...(typeof input.thinking_effort !== "undefined"
      ? { thinkingEffort: input.thinking_effort }
      : {}),
    ...(typeof input.status === "string" ? { status: input.status } : {})
  };

  if (!("schedule_mode" in input)) {
    return common;
  }

  if (input.schedule_mode === "interval") {
    return {
      ...common,
      scheduleMode: "interval",
      intervalUnit: input.interval_unit,
      intervalValue: input.interval_value
    };
  }

  return {
    ...common,
    scheduleMode: "weekly",
    weekday: input.weekday,
    timeOfDay: input.time_of_day
  };
}

export function createManageCronJobsTool(): RuntimeTool {
  return {
    name: "manage_cron_jobs",
    description: buildToolDescription({
      usageScenarios: [
        "List, create, update, or delete recurring cron jobs for the current user.",
        "Create autonomous scheduled agent work that runs in its own session through the worker dispatcher."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "action",
          type: 'literal "list" | "create" | "update" | "delete"',
          required: true,
          description: "Choose the cron job operation."
        }),
        "Use action=list before update or delete when the target cron_job_id is not already known.",
        "For action=create, provide name, prompt, starts_at, schedule_mode, and the required schedule fields.",
        "Omit working_directory to use the current session working directory.",
        "Use status=paused to create a job without dispatching it until resumed."
      ],
      constraints: [
        "starts_at must be a real datetime string; call get_current_time first when relative time needs anchoring.",
        "Interval jobs require interval_unit and interval_value.",
        "Weekly jobs require weekday and time_of_day in HH:mm.",
        "This tool only manages definitions; due jobs are dispatched later by the worker."
      ],
      examples: [
        '{"action":"list"}',
        '{"action":"create","name":"Daily docs check","prompt":"Review docs drift and summarize findings.","starts_at":"2026-05-05T01:00:00.000Z","schedule_mode":"interval","interval_unit":"day","interval_value":1}',
        '{"action":"update","cron_job_id":"job_123","status":"paused"}',
        '{"action":"delete","cron_job_id":"job_123"}'
      ]
    }),
    family: "schedule",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "list" },
            status: { enum: [...CRON_JOB_STATUS_OPTIONS] }
          },
          required: ["action"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "create" },
            name: { type: "string" },
            prompt: { type: "string" },
            working_directory: { type: "string" },
            starts_at: { type: "string" },
            max_runs: { type: ["number", "null"] },
            model: { type: "string" },
            thinking_effort: { enum: [...THINKING_EFFORT_OPTIONS] },
            status: { enum: [...CRON_JOB_STATUS_OPTIONS] },
            schedule_mode: { const: "interval" },
            interval_unit: { enum: [...CRON_INTERVAL_UNIT_OPTIONS] },
            interval_value: { type: "number" }
          },
          required: [
            "action",
            "name",
            "prompt",
            "starts_at",
            "schedule_mode",
            "interval_unit",
            "interval_value"
          ],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "create" },
            name: { type: "string" },
            prompt: { type: "string" },
            working_directory: { type: "string" },
            starts_at: { type: "string" },
            max_runs: { type: ["number", "null"] },
            model: { type: "string" },
            thinking_effort: { enum: [...THINKING_EFFORT_OPTIONS] },
            status: { enum: [...CRON_JOB_STATUS_OPTIONS] },
            schedule_mode: { const: "weekly" },
            weekday: { enum: [...CRON_WEEKDAY_OPTIONS] },
            time_of_day: { type: "string" }
          },
          required: [
            "action",
            "name",
            "prompt",
            "starts_at",
            "schedule_mode",
            "weekday",
            "time_of_day"
          ],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "update" },
            cron_job_id: { type: "string" },
            name: { type: "string" },
            prompt: { type: "string" },
            working_directory: { type: "string" },
            starts_at: { type: "string" },
            max_runs: { type: ["number", "null"] },
            model: { type: ["string", "null"] },
            thinking_effort: {
              anyOf: [{ enum: [...THINKING_EFFORT_OPTIONS] }, { type: "null" }]
            },
            status: { enum: [...CRON_JOB_STATUS_OPTIONS] }
          },
          required: ["action", "cron_job_id"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "update" },
            cron_job_id: { type: "string" },
            name: { type: "string" },
            prompt: { type: "string" },
            working_directory: { type: "string" },
            starts_at: { type: "string" },
            max_runs: { type: ["number", "null"] },
            model: { type: ["string", "null"] },
            thinking_effort: {
              anyOf: [{ enum: [...THINKING_EFFORT_OPTIONS] }, { type: "null" }]
            },
            status: { enum: [...CRON_JOB_STATUS_OPTIONS] },
            schedule_mode: { const: "interval" },
            interval_unit: { enum: [...CRON_INTERVAL_UNIT_OPTIONS] },
            interval_value: { type: "number" }
          },
          required: [
            "action",
            "cron_job_id",
            "schedule_mode",
            "interval_unit",
            "interval_value"
          ],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "update" },
            cron_job_id: { type: "string" },
            name: { type: "string" },
            prompt: { type: "string" },
            working_directory: { type: "string" },
            starts_at: { type: "string" },
            max_runs: { type: ["number", "null"] },
            model: { type: ["string", "null"] },
            thinking_effort: {
              anyOf: [{ enum: [...THINKING_EFFORT_OPTIONS] }, { type: "null" }]
            },
            status: { enum: [...CRON_JOB_STATUS_OPTIONS] },
            schedule_mode: { const: "weekly" },
            weekday: { enum: [...CRON_WEEKDAY_OPTIONS] },
            time_of_day: { type: "string" }
          },
          required: [
            "action",
            "cron_job_id",
            "schedule_mode",
            "weekday",
            "time_of_day"
          ],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "delete" },
            cron_job_id: { type: "string" }
          },
          required: ["action", "cron_job_id"],
          additionalProperties: false
        }
      ]
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("manage_cron_jobs", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }
      if (!context.cronJobRepository) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "CRON_JOBS_NOT_CONFIGURED",
            message: "Cron jobs are not configured."
          }),
          "[manage_cron_jobs] failed\n- cron jobs are not configured"
        );
      }

      if (parsed.data.action === "list") {
        const listInput = parsed.data;
        const cronJobs = (await context.cronJobRepository.list()).filter((job) =>
          typeof listInput.status === "string"
            ? job.status === listInput.status
            : true
        );
        return successResult(
          createToolResult({
            ok: true,
            code: "CRON_JOBS_LISTED",
            message: "Cron jobs listed successfully.",
            data: { cron_jobs: cronJobs } as DomainJsonValue
          }),
          [
            "[manage_cron_jobs] success",
            `- action: list`,
            `- count: ${cronJobs.length}`,
            ...cronJobs.map(formatCronJobLine)
          ].join("\n")
        );
      }

      if (parsed.data.action === "create") {
        const cronJob = await context.cronJobRepository.create({
          ...toCreatePayload(parsed.data, context.workingDirectory)
        });
        return successResult(
          createToolResult({
            ok: true,
            code: "CRON_JOB_CREATED",
            message: "Cron job created successfully.",
            data: { cron_job: cronJob } as DomainJsonValue
          }),
          [
            "[manage_cron_jobs] success",
            "- action: create",
            formatCronJobDetails(cronJob)
          ].join("\n")
        );
      }

      if (parsed.data.action === "update") {
        const cronJob = await context.cronJobRepository.update(
          parsed.data.cron_job_id,
          toUpdatePayload(parsed.data)
        );
        if (!cronJob) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "CRON_JOB_NOT_FOUND",
              message: "Cron job not found."
            }),
            `[manage_cron_jobs] failed\n- cron job not found: ${parsed.data.cron_job_id}`
          );
        }
        return successResult(
          createToolResult({
            ok: true,
            code: "CRON_JOB_UPDATED",
            message: "Cron job updated successfully.",
            data: { cron_job: cronJob } as DomainJsonValue
          }),
          [
            "[manage_cron_jobs] success",
            "- action: update",
            formatCronJobDetails(cronJob)
          ].join("\n")
        );
      }

      const removed = await context.cronJobRepository.remove(parsed.data.cron_job_id);
      if (!removed) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "CRON_JOB_NOT_FOUND",
            message: "Cron job not found."
          }),
          `[manage_cron_jobs] failed\n- cron job not found: ${parsed.data.cron_job_id}`
        );
      }
      return successResult(
        createToolResult({
          ok: true,
          code: "CRON_JOB_DELETED",
          message: "Cron job deleted successfully.",
          data: {
            cron_job_id: removed.id,
            name: removed.name
          } as DomainJsonValue
        }),
        [
          "[manage_cron_jobs] success",
          "- action: delete",
          `- deleted: ${removed.id} ${removed.name}`
        ].join("\n")
      );
    }
  };
}
