import { z } from "zod";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { buildToolDescription } from "./tool-description.js";

const schema = z.object({}).strict();

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(now: Date): string {
  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join(
    "-"
  );
}

function formatTime(now: Date): string {
  return [pad(now.getHours()), pad(now.getMinutes())].join(":");
}

function resolveTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatDisplayText(input: {
  currentDate: string;
  currentLocalDatetime: string;
  currentTimezone: string;
}): string {
  return [
    "[get_current_time] success",
    `- current date: ${input.currentDate}`,
    `- current local datetime: ${input.currentLocalDatetime}`,
    `- current timezone: ${input.currentTimezone}`
  ].join("\n");
}

export function createGetCurrentTimeTool(): RuntimeTool {
  return {
    name: "get_current_time",
    description: buildToolDescription({
      usageScenarios: [
        "Read the current local date or time when the task depends on today, now, or the local timezone.",
        "Resolve relative user requests such as today, tomorrow, or this afternoon using a concrete timestamp."
      ],
      usageInstructions: [
        "Call the tool with no arguments.",
        "Use current_date for date-only logic.",
        "Use current_local_datetime or current_iso_datetime when the exact current time matters.",
        "Use current_timezone when you need to interpret local wall-clock times."
      ],
      constraints: [
        "Do not guess the current date or time from memory when the exact value matters.",
        "The result is the local time at the moment this tool call runs."
      ],
      examples: ["{}"]
    }),
    family: "planning",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute() {
      const now = new Date();
      const currentDate = formatDate(now);
      const currentLocalDatetime = `${currentDate} ${formatTime(now)}`;
      const currentTimezone = resolveTimeZone();
      const data = {
        current_date: currentDate,
        current_local_datetime: currentLocalDatetime,
        current_timezone: currentTimezone,
        current_iso_datetime: now.toISOString()
      };

      return successResult(
        createToolResult({
          ok: true,
          code: "CURRENT_TIME_READ",
          message: "Read the current local date and time.",
          data
        }),
        formatDisplayText({
          currentDate,
          currentLocalDatetime,
          currentTimezone
        })
      );
    }
  };
}
