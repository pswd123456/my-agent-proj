import { randomUUID } from "node:crypto";

import {
  doIntervalsOverlap,
  formatRoutinePreview,
  resolveRoutineTiming,
  sortRoutinesByStartAt,
  type RoutineConflict,
  type RoutineRecord,
  type RoutineSource,
  type RoutineStatus
} from "@ai-app-template/domain";

import type { ProductDatabaseClient } from "./client.js";

export interface CreateRoutineRecordInput {
  userId: string;
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
  getById(userId: string, routineId: string): Promise<RoutineRecord | null>;
  update(
    userId: string,
    routineId: string,
    patch: UpdateRoutineRecordInput
  ): Promise<RoutineRecord | null>;
  remove(userId: string, routineId: string): Promise<RoutineRecord | null>;
  resetAll(userId: string): Promise<number>;
  listByDateRange(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<RoutineRecord[]>;
  listByWeek(userId: string, weekStartDate: string): Promise<RoutineRecord[]>;
  searchByTime(
    userId: string,
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
    userId: string,
    input: {
      date: string;
      startTime: string;
      endTime?: string;
      durationMinutes?: number;
      excludeRoutineId?: string;
    }
  ): Promise<RoutineConflict[]>;
}

interface RoutineRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  start_at: string | Date;
  end_at: string | Date;
  status: string;
  source: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function mapRoutineRow(row: RoutineRow): RoutineRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes: row.duration_minutes,
    startAt: toIsoString(row.start_at),
    endAt: toIsoString(row.end_at),
    status: row.status as RoutineStatus,
    source: row.source as RoutineSource,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
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
  constructor(private readonly sql: ProductDatabaseClient) {}

  async create(input: CreateRoutineRecordInput): Promise<RoutineRecord> {
    const timing = resolveRoutineTiming(toTimingInput(input));

    const routineId = randomUUID();
    const rows = await this.sql<RoutineRow[]>`
      insert into routines (
        id,
        user_id,
        name,
        description,
        date,
        start_time,
        end_time,
        duration_minutes,
        start_at,
        end_at,
        status,
        source
      )
      values (
        ${routineId},
        ${input.userId},
        ${input.name},
        ${input.description ?? null},
        ${timing.date},
        ${timing.startTime},
        ${timing.endTime},
        ${timing.durationMinutes},
        ${timing.startAt},
        ${timing.endAt},
        ${"active"},
        ${input.source}
      )
      returning *
    `;

    const created = rows[0];
    if (!created) {
      throw new Error("Failed to create routine.");
    }

    return mapRoutineRow(created);
  }

  async getById(
    userId: string,
    routineId: string
  ): Promise<RoutineRecord | null> {
    const rows = await this.sql<RoutineRow[]>`
      select *
      from routines
      where id = ${routineId}
        and user_id = ${userId}
      limit 1
    `;
    return rows[0] ? mapRoutineRow(rows[0]) : null;
  }

  async update(
    userId: string,
    routineId: string,
    patch: UpdateRoutineRecordInput
  ): Promise<RoutineRecord | null> {
    const existing = await this.getById(userId, routineId);
    if (!existing || existing.status !== "active") {
      return null;
    }

    const timing = resolveRoutineTiming(
      toTimingInput({
        date: patch.date ?? existing.date,
        startTime: patch.startTime ?? existing.startTime,
        endTime: patch.endTime ?? existing.endTime,
        durationMinutes: patch.durationMinutes ?? existing.durationMinutes
      })
    );

    const rows = await this.sql<RoutineRow[]>`
      update routines
      set
        name = ${patch.name ?? existing.name},
        description = ${
          typeof patch.description === "undefined"
            ? existing.description
            : patch.description
        },
        date = ${timing.date},
        start_time = ${timing.startTime},
        end_time = ${timing.endTime},
        duration_minutes = ${timing.durationMinutes},
        start_at = ${timing.startAt},
        end_at = ${timing.endAt},
        updated_at = now()
      where id = ${routineId}
        and user_id = ${userId}
      returning *
    `;

    return rows[0] ? mapRoutineRow(rows[0]) : null;
  }

  async remove(
    userId: string,
    routineId: string
  ): Promise<RoutineRecord | null> {
    const rows = await this.sql<RoutineRow[]>`
      update routines
      set
        status = ${"deleted"},
        updated_at = now()
      where id = ${routineId}
        and user_id = ${userId}
        and status = ${"active"}
      returning *
    `;

    return rows[0] ? mapRoutineRow(rows[0]) : null;
  }

  async resetAll(userId: string): Promise<number> {
    const rows = await this.sql<Array<{ id: string }>>`
      update routines
      set
        status = ${"deleted"},
        updated_at = now()
      where user_id = ${userId}
        and status = ${"active"}
      returning id
    `;

    return rows.length;
  }

  async listByDateRange(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<RoutineRecord[]> {
    const range = buildRangeDates(startDate, endDate);
    const rows = await this.sql<RoutineRow[]>`
      select *
      from routines
      where user_id = ${userId}
        and status = ${"active"}
        and start_at <= ${range.endAt.toISOString()}
        and end_at >= ${range.startAt.toISOString()}
      order by start_at asc
    `;

    return sortRoutinesByStartAt(rows.map(mapRoutineRow));
  }

  async listByWeek(
    userId: string,
    weekStartDate: string
  ): Promise<RoutineRecord[]> {
    const weekStart = new Date(`${weekStartDate}T00:00:00`);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    const rows = await this.sql<RoutineRow[]>`
      select *
      from routines
      where user_id = ${userId}
        and status = ${"active"}
        and start_at <= ${weekEnd.toISOString()}
        and end_at >= ${weekStart.toISOString()}
      order by start_at asc
    `;

    return sortRoutinesByStartAt(rows.map(mapRoutineRow));
  }

  async searchByTime(
    userId: string,
    input: {
      date: string;
      time?: string;
      timeRange?: { start: string; end: string };
    }
  ): Promise<RoutineRecord[]> {
    const startTime = input.timeRange?.start ?? input.time;
    const endTime = input.timeRange?.end ?? input.time;

    if (!startTime || !endTime) {
      return this.listByDateRange(userId, input.date, input.date);
    }

    const timing = resolveRoutineTiming(
      toTimingInput({
        date: input.date,
        startTime,
        endTime
      })
    );

    const rows = await this.sql<RoutineRow[]>`
      select *
      from routines
      where user_id = ${userId}
        and status = ${"active"}
        and start_at < ${timing.endAt}
        and end_at > ${timing.startAt}
      order by start_at asc
    `;

    return sortRoutinesByStartAt(rows.map(mapRoutineRow));
  }

  async findConflicts(
    userId: string,
    input: {
      date: string;
      startTime: string;
      endTime?: string;
      durationMinutes?: number;
      excludeRoutineId?: string;
    }
  ): Promise<RoutineConflict[]> {
    const timing = resolveRoutineTiming(toTimingInput(input));

    const rows = await this.sql<RoutineRow[]>`
      select *
      from routines
      where user_id = ${userId}
        and status = ${"active"}
        and start_at < ${timing.endAt}
        and end_at > ${timing.startAt}
        ${
          input.excludeRoutineId
            ? this.sql`and id <> ${input.excludeRoutineId}`
            : this.sql``
        }
      order by start_at asc
    `;

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
      userId: input.userId,
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

  async getById(
    userId: string,
    routineId: string
  ): Promise<RoutineRecord | null> {
    const routine = this.routines.get(routineId);
    return routine && routine.userId === userId
      ? structuredClone(routine)
      : null;
  }

  async update(
    userId: string,
    routineId: string,
    patch: UpdateRoutineRecordInput
  ): Promise<RoutineRecord | null> {
    const existing = await this.getById(userId, routineId);
    if (!existing || existing.status !== "active") {
      return null;
    }

    const timing = resolveRoutineTiming(
      toTimingInput({
        date: patch.date ?? existing.date,
        startTime: patch.startTime ?? existing.startTime,
        endTime: patch.endTime ?? existing.endTime,
        durationMinutes: patch.durationMinutes ?? existing.durationMinutes
      })
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

  async remove(
    userId: string,
    routineId: string
  ): Promise<RoutineRecord | null> {
    const existing = await this.getById(userId, routineId);
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

  async resetAll(userId: string): Promise<number> {
    let removed = 0;

    for (const [routineId, routine] of this.routines.entries()) {
      if (routine.userId !== userId || routine.status !== "active") {
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
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<RoutineRecord[]> {
    const range = buildRangeDates(startDate, endDate);
    return sortRoutinesByStartAt(
      [...this.routines.values()].filter(
        (routine) =>
          routine.userId === userId &&
          routine.status === "active" &&
          new Date(routine.startAt).getTime() <= range.endAt.getTime() &&
          new Date(routine.endAt).getTime() >= range.startAt.getTime()
      )
    ).map((routine) => structuredClone(routine));
  }

  async listByWeek(
    userId: string,
    weekStartDate: string
  ): Promise<RoutineRecord[]> {
    const startDate = weekStartDate;
    const weekEnd = new Date(`${weekStartDate}T00:00:00`);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return this.listByDateRange(
      userId,
      startDate,
      weekEnd.toISOString().slice(0, 10)
    );
  }

  async searchByTime(
    userId: string,
    input: {
      date: string;
      time?: string;
      timeRange?: { start: string; end: string };
    }
  ): Promise<RoutineRecord[]> {
    const routines = await this.listByDateRange(userId, input.date, input.date);
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
    userId: string,
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
          routine.userId === userId &&
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
  sql: ProductDatabaseClient
): RoutineRepository {
  return new PostgresRoutineRepository(sql);
}

export function createMemoryRoutineRepository(): RoutineRepository {
  return new MemoryRoutineRepository();
}
