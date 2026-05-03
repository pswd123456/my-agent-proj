import { describe, expect, test } from "bun:test";

import {
  resolveCronJobNextRunAt,
  resolveCronJobRemainingRuns,
  resolveCronJobScheduledRunAt,
  resolveCronJobStatusAfterRun,
  updateCronJobPayloadSchema
} from "../src/cron-job.js";

describe("cron job scheduling", () => {
  test("keeps interval jobs anchored to planned time", () => {
    const startsAt = "2026-05-02T09:15:00";
    const scheduled = new Date(
      resolveCronJobScheduledRunAt({
        scheduleMode: "interval",
        startsAt,
        intervalUnit: "hour",
        intervalValue: 2,
        runIndex: 3
      })
    );

    expect(scheduled.getTime() - new Date(startsAt).getTime()).toBe(
      6 * 60 * 60 * 1_000
    );
  });

  test("resolves the first weekly run on or after startsAt", () => {
    const scheduled = new Date(
      resolveCronJobScheduledRunAt({
        scheduleMode: "weekly",
        startsAt: "2026-05-06T10:30:00+08:00",
        weekday: "wednesday",
        timeOfDay: "12:15",
        runIndex: 0
      })
    );

    expect(scheduled.getDay()).toBe(3);
    expect(scheduled.getHours()).toBe(12);
    expect(scheduled.getMinutes()).toBe(15);
  });

  test("advances weekly jobs by seven days", () => {
    const firstRun = new Date(
      resolveCronJobScheduledRunAt({
        scheduleMode: "weekly",
        startsAt: "2026-05-06T10:30:00+08:00",
        weekday: "wednesday",
        timeOfDay: "12:15",
        runIndex: 0
      })
    );
    const thirdRun = new Date(
      resolveCronJobScheduledRunAt({
        scheduleMode: "weekly",
        startsAt: "2026-05-06T10:30:00+08:00",
        weekday: "wednesday",
        timeOfDay: "12:15",
        runIndex: 2
      })
    );

    expect(
      Math.round((thirdRun.getTime() - firstRun.getTime()) / (24 * 60 * 60 * 1_000))
    ).toBe(14);
  });

  test("returns null once finite jobs reach max runs", () => {
    expect(
      resolveCronJobNextRunAt({
        scheduleMode: "interval",
        startsAt: "2026-05-02T09:15:00",
        intervalUnit: "day",
        intervalValue: 1,
        runCount: 3,
        maxRuns: 3
      })
    ).toBeNull();
  });

  test("tracks remaining runs and completed transition", () => {
    expect(resolveCronJobRemainingRuns({ maxRuns: 5, runCount: 2 })).toBe(3);
    expect(
      resolveCronJobStatusAfterRun({
        runCount: 5,
        maxRuns: 5,
        statusWhenRunnable: "active"
      })
    ).toBe("completed");
  });
});

describe("updateCronJobPayloadSchema", () => {
  test("accepts common-only status patches", () => {
    expect(
      updateCronJobPayloadSchema.parse({
        status: "paused"
      })
    ).toEqual({ status: "paused" });
  });

  test("rejects mixed weekly and interval fields", () => {
    expect(() =>
      updateCronJobPayloadSchema.parse({
        scheduleMode: "interval",
        intervalUnit: "hour",
        intervalValue: 3,
        weekday: "friday"
      })
    ).toThrow();
  });
});
