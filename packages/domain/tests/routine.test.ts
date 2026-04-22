import { describe, expect, test } from "bun:test";

import {
  mergeRoutineTimingForUpdate,
  resolveRoutineTiming,
  type RoutineRecord
} from "../src/routine";

const existingRoutine: Pick<
  RoutineRecord,
  "date" | "startTime" | "endTime" | "durationMinutes"
> = {
  date: "2026-04-23",
  startTime: "14:00",
  endTime: "15:30",
  durationMinutes: 90
};

describe("mergeRoutineTimingForUpdate", () => {
  test("preserves duration when only start time changes", () => {
    const merged = mergeRoutineTimingForUpdate(existingRoutine, {
      startTime: "19:00"
    });

    expect(merged).toEqual({
      date: "2026-04-23",
      startTime: "19:00",
      durationMinutes: 90
    });
    expect(resolveRoutineTiming(merged)).toMatchObject({
      startTime: "19:00",
      endTime: "20:30",
      durationMinutes: 90
    });
  });

  test("derives duration from explicit end time when start and end change", () => {
    const merged = mergeRoutineTimingForUpdate(existingRoutine, {
      startTime: "19:00",
      endTime: "20:00"
    });

    expect(merged).toEqual({
      date: "2026-04-23",
      startTime: "19:00",
      endTime: "20:00"
    });
    expect(resolveRoutineTiming(merged)).toMatchObject({
      startTime: "19:00",
      endTime: "20:00",
      durationMinutes: 60
    });
  });

  test("keeps explicit duration validation when duration is provided", () => {
    const merged = mergeRoutineTimingForUpdate(existingRoutine, {
      startTime: "19:00",
      endTime: "20:00",
      durationMinutes: 90
    });

    expect(() => resolveRoutineTiming(merged)).toThrow(
      "durationMinutes does not match the provided time range."
    );
  });
});
