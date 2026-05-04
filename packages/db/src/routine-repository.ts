import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  eq,
  gte,
  lt,
  lte,
  gt,
  ne
} from "drizzle-orm";

import {
  doIntervalsOverlap,
  formatRoutinePreview,
  mergeRoutineTimingForUpdate,
  resolveRoutineTiming,
  sortRoutinesByStartAt,
  type RoutineConflict,
  type RoutineRecord,
  type RoutineSource,
  type RoutineStatus
} from "@ai-app-template/domain";

import type { ProductDatabaseClient } from "./client.js";
import { routines } from "./schema.js";

export interface CreateRoutineRecordInput {
  name: string;
  description?: string | null;
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  source: RoutineSource;
}

export interface UpdateRoutineRecordInput {
  name?: string;
  description?: string | null;
  date?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
}

export interface RoutineRepository {
  create(input: CreateRoutineRecordInput): Promise<RoutineRecord>;
  getById(routineId: string): Promise<RoutineRecord | null>;
  update(
    routineId: string,
    patch: UpdateRoutineRecordInput
  ): Promise<RoutineRecord | null>;
  remove(routineId: string): Promise<RoutineRecord | null>;
  resetAll(): Promise<number>;
  listByDateRange(
    startDate: string,
    endDate: string
  ): Promise<RoutineRecord[]>;
  listByWeek(weekStartDate: string): Promise<RoutineRecord[]>;
  searchByTime(
    input: {
      date: string;
      time?: string;
      timeRange?: {
        start: string;
        end: string;
      };
    }
  ): Promise<RoutineRecord[]>;
  findConflicts(
    input: {
      date: string;
      startTime: string;
      endTime?: string;
      durationMinutes?: number;
      excludeRoutineId?: string;
    }
  ): Promise<RoutineConflict[]>;
}

type RoutineRow = typeof routines.$inferSelect;

function toIsoString(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const tzMatch = normalized.match(/([+-]\d{2})(\d{2})?$/);
  const hasExplicitTimeZone =
    normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized) || tzMatch;
  const parsedValue = tzMatch
    ? normalized.replace(/([+-]\d{2})(\d{2})?$/, (_, hours: string, minutes?: string) =>
        `${hours}:${minutes ?? "00"}`
      )
    : normalized;

  return new Date(hasExplicitTimeZone ? parsedValue : `${normalized}Z`).toISOString();
}

export function mapRoutineRow(row: RoutineRow): RoutineRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    startAt: toIsoString(row.startAt),
    endAt: toIsoString(row.endAt),
    status: row.status as RoutineStatus,
    source: row.source as RoutineSource,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function buildRangeDates(
  startDate: string,
  endDate: string
): {
  startAt: Date;
  endAt: Date;
} {
  const startAt = new Date(`${startDate}T00:00:00`);
  const endAt = new Date(`${endDate}T23:59:59`);
  return { startAt, endAt };
}

function toTimingInput(input: {
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
}): {
  date: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
} {
  const timingInput: {
    date: string;
    startTime: string;
    endTime?: string;
    durationMinutes?: number;
  } = {
    date: input.date,
    startTime: input.startTime
  };

  if (typeof input.endTime === "string") {
    timingInput.endTime = input.endTime;
  }

  if (typeof input.durationMinutes === "number") {
    timingInput.durationMinutes = input.durationMinutes;
  }

  return timingInput;
}

export class PostgresRoutineRepository implements RoutineRepository {
  constructor(private readonly db: ProductDatabaseClient) {}

  async create(input: CreateRoutineRecordInput): Promise<RoutineRecord> {
    const timing = resolveRoutineTiming(toTimingInput(input));

    const routineId = randomUUID();
    const rows = await this.db
      .insert(routines)
      .values({
        id: routineId,
        name: input.name,
        description: input.description ?? null,
        date: timing.date,
        startTime: timing.startTime,
        endTime: timing.endTime,
        durationMinutes: timing.durationMinutes,
        startAt: timing.startAt,
        endAt: timing.endAt,
        status: "active",
        source: input.source
      })
      .returning();

    const created = rows[0];
    if (!created) {
      throw new Error("Failed to create routine.");
    }

    return mapRoutineRow(created);
  }

  async getById(routineId: string): Promise<RoutineRecord | null> {
    const rows = await this.db
      .select()
      .from(routines)
      .where(eq(routines.id, routineId))
      .limit(1);

    return rows[0] ? mapRoutineRow(rows[0]) : null;
  }

  async update(
    routineId: string,
    patch: UpdateRoutineRecordInput
  ): Promise<RoutineRecord | null> {
    const existing = await this.getById(routineId);
    if (!existing || existing.status !== "active") {
      return null;
    }

    const timing = resolveRoutineTiming(
      mergeRoutineTimingForUpdate(existing, patch)
    );

    const rows = await this.db
      .update(routines)
      .set({
        name: patch.name ?? existing.name,
        description:
          typeof patch.description === "undefined"
            ? existing.description
            : patch.description,
        date: timing.date,
        startTime: timing.startTime,
        endTime: timing.endTime,
        durationMinutes: timing.durationMinutes,
        startAt: timing.startAt,
        endAt: timing.endAt,
        updatedAt: new Date().toISOString()
      })
      .where(eq(routines.id, routineId))
      .returning();

    return rows[0] ? mapRoutineRow(rows[0]) : null;
  }

  async remove(routineId: string): Promise<RoutineRecord | null> {
    const rows = await this.db
      .update(routines)
      .set({
        status: "deleted",
        updatedAt: new Date().toISOString()
      })
      .where(
        and(
          eq(routines.id, routineId),
          eq(routines.status, "active")
        )
      )
      .returning();

    return rows[0] ? mapRoutineRow(rows[0]) : null;
  }

  async resetAll(): Promise<number> {
    const rows = await this.db
      .update(routines)
      .set({
        status: "deleted",
        updatedAt: new Date().toISOString()
      })
      .where(eq(routines.status, "active"))
      .returning({ id: routines.id });

    return rows.length;
  }

  async listByDateRange(
    startDate: string,
    endDate: string
  ): Promise<RoutineRecord[]> {
    const range = buildRangeDates(startDate, endDate);
    const rows = await this.db
      .select()
      .from(routines)
      .where(
        and(
          eq(routines.status, "active"),
          lte(routines.startAt, range.endAt.toISOString()),
          gte(routines.endAt, range.startAt.toISOString())
        )
      )
      .orderBy(asc(routines.startAt));

    return sortRoutinesByStartAt(rows.map(mapRoutineRow));
  }

  async listByWeek(weekStartDate: string): Promise<RoutineRecord[]> {
    const weekStart = new Date(`${weekStartDate}T00:00:00`);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    const rows = await this.db
      .select()
      .from(routines)
      .where(
        and(
          eq(routines.status, "active"),
          lte(routines.startAt, weekEnd.toISOString()),
          gte(routines.endAt, weekStart.toISOString())
        )
      )
      .orderBy(asc(routines.startAt));

    return sortRoutinesByStartAt(rows.map(mapRoutineRow));
  }

  async searchByTime(
    input: {
      date: string;
      time?: string;
      timeRange?: { start: string; end: string };
    }
  ): Promise<RoutineRecord[]> {
    const startTime = input.timeRange?.start ?? input.time;
    const endTime = input.timeRange?.end ?? input.time;

    if (!startTime || !endTime) {
      return this.listByDateRange(input.date, input.date);
    }

    const timing = resolveRoutineTiming(
      toTimingInput({
        date: input.date,
        startTime,
        endTime
      })
    );

    const rows = await this.db
      .select()
      .from(routines)
      .where(
        and(
          eq(routines.status, "active"),
          lt(routines.startAt, timing.endAt),
          gt(routines.endAt, timing.startAt)
        )
      )
      .orderBy(asc(routines.startAt));

    return sortRoutinesByStartAt(rows.map(mapRoutineRow));
  }

  async findConflicts(
    input: {
      date: string;
      startTime: string;
      endTime?: string;
      durationMinutes?: number;
      excludeRoutineId?: string;
    }
  ): Promise<RoutineConflict[]> {
    const timing = resolveRoutineTiming(toTimingInput(input));

    const conditions = [
      eq(routines.status, "active"),
      lt(routines.startAt, timing.endAt),
      gt(routines.endAt, timing.startAt)
    ];

    if (input.excludeRoutineId) {
      conditions.push(ne(routines.id, input.excludeRoutineId));
    }

    const rows = await this.db
      .select()
      .from(routines)
      .where(and(...conditions))
      .orderBy(asc(routines.startAt));

    const candidate = {
      startAt: new Date(timing.startAt).toISOString(),
      endAt: new Date(timing.endAt).toISOString()
    };

    return rows
      .map(mapRoutineRow)
      .filter((routine) => doIntervalsOverlap(routine, candidate))
      .map((routine) => ({
        routine,
        previewText: formatRoutinePreview(routine)
      }));
  }
}

export class MemoryRoutineRepository implements RoutineRepository {
  private readonly routines = new Map<string, RoutineRecord>();

  async create(input: CreateRoutineRecordInput): Promise<RoutineRecord> {
    const timing = resolveRoutineTiming(toTimingInput(input));
    const now = new Date().toISOString();
    const routine: RoutineRecord = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      date: timing.date,
      startTime: timing.startTime,
      endTime: timing.endTime,
      durationMinutes: timing.durationMinutes,
      startAt: new Date(timing.startAt).toISOString(),
      endAt: new Date(timing.endAt).toISOString(),
      status: "active",
      source: input.source,
      createdAt: now,
      updatedAt: now
    };

    this.routines.set(routine.id, routine);
    return routine;
  }

  async getById(routineId: string): Promise<RoutineRecord | null> {
    const routine = this.routines.get(routineId);
    return routine ? structuredClone(routine) : null;
  }

  async update(
    routineId: string,
    patch: UpdateRoutineRecordInput
  ): Promise<RoutineRecord | null> {
    const existing = await this.getById(routineId);
    if (!existing || existing.status !== "active") {
      return null;
    }

    const timing = resolveRoutineTiming(
      mergeRoutineTimingForUpdate(existing, patch)
    );

    const updated: RoutineRecord = {
      ...existing,
      name: patch.name ?? existing.name,
      description:
        typeof patch.description === "undefined"
          ? existing.description
          : patch.description,
      date: timing.date,
      startTime: timing.startTime,
      endTime: timing.endTime,
      durationMinutes: timing.durationMinutes,
      startAt: new Date(timing.startAt).toISOString(),
      endAt: new Date(timing.endAt).toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.routines.set(updated.id, updated);
    return structuredClone(updated);
  }

  async remove(routineId: string): Promise<RoutineRecord | null> {
    const existing = await this.getById(routineId);
    if (!existing || existing.status !== "active") {
      return null;
    }

    const deleted: RoutineRecord = {
      ...existing,
      status: "deleted",
      updatedAt: new Date().toISOString()
    };
    this.routines.set(deleted.id, deleted);
    return structuredClone(deleted);
  }

  async resetAll(): Promise<number> {
    let removed = 0;

    for (const [routineId, routine] of this.routines.entries()) {
      if (routine.status !== "active") {
        continue;
      }

      this.routines.set(routineId, {
        ...routine,
        status: "deleted",
        updatedAt: new Date().toISOString()
      });
      removed += 1;
    }

    return removed;
  }

  async listByDateRange(
    startDate: string,
    endDate: string
  ): Promise<RoutineRecord[]> {
    const range = buildRangeDates(startDate, endDate);
    return sortRoutinesByStartAt(
      [...this.routines.values()].filter(
        (routine) =>
          routine.status === "active" &&
          new Date(routine.startAt).getTime() <= range.endAt.getTime() &&
          new Date(routine.endAt).getTime() >= range.startAt.getTime()
      )
    ).map((routine) => structuredClone(routine));
  }

  async listByWeek(weekStartDate: string): Promise<RoutineRecord[]> {
    const startDate = weekStartDate;
    const weekEnd = new Date(`${weekStartDate}T00:00:00`);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return this.listByDateRange(startDate, weekEnd.toISOString().slice(0, 10));
  }

  async searchByTime(
    input: {
      date: string;
      time?: string;
      timeRange?: { start: string; end: string };
    }
  ): Promise<RoutineRecord[]> {
    const routines = await this.listByDateRange(input.date, input.date);
    if (!input.time && !input.timeRange) {
      return routines;
    }

    const timing = resolveRoutineTiming(
      toTimingInput({
        date: input.date,
        startTime: input.timeRange?.start ?? input.time ?? "00:00",
        endTime: input.timeRange?.end ?? input.time ?? "23:59"
      })
    );
    const candidate = {
      startAt: new Date(timing.startAt).toISOString(),
      endAt: new Date(timing.endAt).toISOString()
    };
    return routines.filter((routine) => doIntervalsOverlap(routine, candidate));
  }

  async findConflicts(
    input: {
      date: string;
      startTime: string;
      endTime?: string;
      durationMinutes?: number;
      excludeRoutineId?: string;
    }
  ): Promise<RoutineConflict[]> {
    const timing = resolveRoutineTiming(toTimingInput(input));
    const candidate = {
      startAt: new Date(timing.startAt).toISOString(),
      endAt: new Date(timing.endAt).toISOString()
    };

    return [...this.routines.values()]
      .filter(
        (routine) =>
          routine.status === "active" &&
          routine.id !== input.excludeRoutineId &&
          doIntervalsOverlap(routine, candidate)
      )
      .map((routine) => ({
        routine: structuredClone(routine),
        previewText: formatRoutinePreview(routine)
      }));
  }
}

export function createPostgresRoutineRepository(
  db: ProductDatabaseClient
): RoutineRepository {
  return new PostgresRoutineRepository(db);
}

export function createMemoryRoutineRepository(): RoutineRepository {
  return new MemoryRoutineRepository();
}
