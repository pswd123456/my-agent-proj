import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TraceRecord } from "../packages/agent/src/trace.js";
import {
  createPostgresDatabase,
  resolveDatabaseUrl
} from "../packages/db/src/client.js";

interface SessionRow {
  id: string;
}

interface SessionMessageRow {
  id: string;
  session_id: string;
  message_index: number;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  created_at: string | Date;
}

const MIN_REPAIR_DELTA_MS = 60_000;
const REPAIR_GRANULARITY_MS = 60 * 60 * 1000;

function toMilliseconds(value: string | Date): number {
  return new Date(value).getTime();
}

function roundRepairDelta(deltaMs: number): number {
  return Math.round(deltaMs / REPAIR_GRANULARITY_MS) * REPAIR_GRANULARITY_MS;
}

async function readTraceRecords(
  tracesDirectory: string,
  sessionId: string
): Promise<TraceRecord[]> {
  const filePath = path.join(tracesDirectory, `${sessionId}.trace.jsonl`);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as TraceRecord];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function resolveRepairDeltaMs(
  messages: SessionMessageRow[],
  traceRecords: TraceRecord[]
): number | null {
  const traceToolCallTimes = new Map<string, number>();
  const traceToolResultTimes = new Map<string, number>();

  for (const record of traceRecords) {
    if (record.event.kind === "tool_call") {
      traceToolCallTimes.set(record.event.toolCallId, toMilliseconds(record.createdAt));
      continue;
    }

    if (record.event.kind === "tool_result") {
      traceToolResultTimes.set(
        record.event.toolCallId,
        toMilliseconds(record.createdAt)
      );
    }
  }

  const deltaCandidates: number[] = [];

  for (const message of messages) {
    if (!message.tool_call_id) {
      continue;
    }

    if (message.role === "tool_call") {
      const traceTime = traceToolCallTimes.get(message.tool_call_id);
      if (typeof traceTime === "number") {
        deltaCandidates.push(traceTime - toMilliseconds(message.created_at));
      }
      continue;
    }

    if (message.role === "tool_result") {
      const traceTime = traceToolResultTimes.get(message.tool_call_id);
      if (typeof traceTime === "number") {
        deltaCandidates.push(traceTime - toMilliseconds(message.created_at));
      }
    }
  }

  if (deltaCandidates.length === 0) {
    const assistantMessages = messages.filter(
      (message) => message.role === "assistant" && message.content
    );
    const assistantEvents = traceRecords.filter(
      (record) => record.event.kind === "assistant_text"
    );
    const usedEventIndexes = new Set<number>();

    for (const message of assistantMessages) {
      const eventIndex = assistantEvents.findIndex(
        (record, index) =>
          !usedEventIndexes.has(index) &&
          record.event.kind === "assistant_text" &&
          record.event.text === message.content
      );

      if (eventIndex < 0) {
        continue;
      }

      usedEventIndexes.add(eventIndex);
      deltaCandidates.push(
        toMilliseconds(assistantEvents[eventIndex].createdAt) -
          toMilliseconds(message.created_at)
      );
    }
  }

  if (deltaCandidates.length === 0) {
    return null;
  }

  deltaCandidates.sort((left, right) => left - right);
  const medianDelta =
    deltaCandidates[Math.floor(deltaCandidates.length / 2)] ?? null;

  if (medianDelta === null) {
    return null;
  }

  const roundedDelta = roundRepairDelta(medianDelta);
  return Math.abs(roundedDelta) >= MIN_REPAIR_DELTA_MS ? roundedDelta : null;
}

async function main(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl(process.env);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
  const tracesDirectory = path.join(
    workspaceRoot,
    "tmp",
    "agent-sessions",
    "sessions"
  );
  const shouldApply = process.argv.includes("--apply");
  const database = createPostgresDatabase(databaseUrl);

  try {
    const sessions = await database<SessionRow[]>`
      select id
      from agent_sessions
      order by id asc
    `;

    const repairedSessions: Array<{ sessionId: string; deltaHours: number }> =
      [];

    for (const session of sessions) {
      const traceRecords = await readTraceRecords(tracesDirectory, session.id);
      if (traceRecords.length === 0) {
        continue;
      }

      const messages = await database<SessionMessageRow[]>`
        select id, session_id, message_index, role, content, tool_call_id, created_at
        from session_messages
        where session_id = ${session.id}
        order by message_index asc
      `;
      const deltaMs = resolveRepairDeltaMs(messages, traceRecords);

      if (deltaMs === null) {
        continue;
      }

      repairedSessions.push({
        sessionId: session.id,
        deltaHours: deltaMs / (60 * 60 * 1000)
      });

      if (!shouldApply) {
        continue;
      }

      await database.begin(async (sql) => {
        await sql`
          update session_messages
          set created_at = created_at + (${deltaMs} * interval '1 millisecond')
          where session_id = ${session.id}
        `;

        await sql`
          update agent_sessions
          set
            created_at = created_at + (${deltaMs} * interval '1 millisecond'),
            updated_at = updated_at + (${deltaMs} * interval '1 millisecond'),
            active_run_started_at = case
              when active_run_started_at is null then null
              else active_run_started_at + (${deltaMs} * interval '1 millisecond')
            end
          where id = ${session.id}
        `;

        await sql`
          update agent_sessions as sessions
          set updated_at = coalesce(
            (
              select max(messages.created_at)
              from session_messages as messages
              where messages.session_id = sessions.id
            ),
            sessions.updated_at
          )
          where sessions.id = ${session.id}
        `;
      });
    }

    if (repairedSessions.length === 0) {
      console.log(
        shouldApply
          ? "No sessions required timestamp repair."
          : "Dry run: no sessions require timestamp repair."
      );
      return;
    }

    const actionLabel = shouldApply ? "Repaired" : "Would repair";
    for (const session of repairedSessions) {
      console.log(
        `${actionLabel} session ${session.sessionId} by ${session.deltaHours} hours.`
      );
    }
  } finally {
    await database.end({ timeout: 1 });
  }
}

await main();
