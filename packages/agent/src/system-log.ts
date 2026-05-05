import { promises as fs } from "node:fs";
import path from "node:path";

import type { JsonValue } from "./types.js";

export type SystemLogLevel = "debug" | "info" | "warn" | "error";
export type SystemLogComponent =
  | "runtime"
  | "permission"
  | "tool-execution"
  | "confirmation"
  | "interrupt"
  | "api"
  | "worker"
  | "gateway";

export interface SystemLogRecord {
  timestamp: string;
  level: SystemLogLevel;
  component: SystemLogComponent;
  event: string;
  sessionId?: string;
  turnCount?: number;
  runId?: string;
  requestId?: string;
  details: JsonValue;
}

export interface SystemLogQuery {
  sessionId?: string;
  level?: SystemLogLevel;
  component?: SystemLogComponent;
  event?: string;
  runId?: string;
  requestId?: string;
  limit?: number;
  cursor?: string;
}

export interface SystemLogQueryResult {
  records: SystemLogRecord[];
  nextCursor: string | null;
}

export interface SystemLogManager {
  append(record: SystemLogRecord): Promise<void>;
  query(input?: SystemLogQuery): Promise<SystemLogQueryResult>;
}

export interface LoggerContext {
  sessionId?: string;
  turnCount?: number;
  runId?: string;
  requestId?: string;
}

export interface Logger {
  child(context: LoggerContext): Logger;
  debug(event: string, details?: JsonValue): Promise<void>;
  info(event: string, details?: JsonValue): Promise<void>;
  warn(event: string, details?: JsonValue): Promise<void>;
  error(event: string, details?: JsonValue): Promise<void>;
}

const LEVEL_WEIGHT: Record<SystemLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const ACTIVE_LOG_FILENAME = "system.log.jsonl";
const DETAIL_MAX_STRING_LENGTH = 400;
const DETAIL_TRUNCATED_STRING_EDGE_LENGTH = 180;
const DIAGNOSTIC_DETAIL_MAX_STRING_LENGTH = 8_000;
const DETAIL_MAX_ARRAY_LENGTH = 20;
const DETAIL_MAX_OBJECT_KEYS = 20;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;

const DIAGNOSTIC_DETAIL_KEYS = new Set([
  "cause",
  "query",
  "stack",
  "stderr",
  "stdout"
]);

function stringLimitForLogKey(key: string | undefined): number {
  return key && DIAGNOSTIC_DETAIL_KEYS.has(key)
    ? DIAGNOSTIC_DETAIL_MAX_STRING_LENGTH
    : DETAIL_MAX_STRING_LENGTH;
}

function truncateStringForLog(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const edgeLength =
    maxLength === DETAIL_MAX_STRING_LENGTH
      ? DETAIL_TRUNCATED_STRING_EDGE_LENGTH
      : Math.max(
          DETAIL_TRUNCATED_STRING_EDGE_LENGTH,
          Math.floor(maxLength / 2) - 80
        );
  const omittedCount = value.length - edgeLength * 2;
  return [
    value.slice(0, edgeLength),
    `...[truncated ${omittedCount} chars]...`,
    value.slice(-edgeLength)
  ].join("\n");
}

function limitArrayEntries<T>(entries: readonly T[], maxEntries: number): T[] {
  if (entries.length <= maxEntries) {
    return [...entries];
  }

  const headCount = Math.ceil(maxEntries / 2);
  const tailCount = Math.floor(maxEntries / 2);
  return [
    ...entries.slice(0, headCount),
    ...entries.slice(entries.length - tailCount)
  ];
}

function sanitizeValue(
  value: JsonValue | undefined,
  depth = 0,
  key?: string
): JsonValue {
  if (typeof value === "undefined") {
    return null;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return truncateStringForLog(value, stringLimitForLogKey(key));
  }

  if (Array.isArray(value)) {
    if (depth >= 4) {
      return `[truncated array:${value.length}]`;
    }

    const limited = limitArrayEntries(value, DETAIL_MAX_ARRAY_LENGTH).map(
      (entry) => sanitizeValue(entry, depth + 1, key)
    );
    if (value.length > DETAIL_MAX_ARRAY_LENGTH) {
      limited.splice(
        Math.ceil(limited.length / 2),
        0,
        `[truncated ${value.length - DETAIL_MAX_ARRAY_LENGTH} items]`
      );
    }
    return limited;
  }

  if (depth >= 4) {
    return "[truncated object]";
  }

  const entries = limitArrayEntries(
    Object.entries(value),
    DETAIL_MAX_OBJECT_KEYS
  );
  const sanitized: Record<string, JsonValue> = {};
  for (const [key, entry] of entries) {
    sanitized[key] = sanitizeValue(entry as JsonValue, depth + 1, key);
  }
  if (Object.keys(value).length > DETAIL_MAX_OBJECT_KEYS) {
    sanitized.__truncated__ = `[truncated ${Object.keys(value).length - DETAIL_MAX_OBJECT_KEYS} keys]`;
  }
  return sanitized;
}

function parseLevel(input: string | undefined): SystemLogLevel {
  const normalized = input?.trim().toLowerCase();
  if (
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return "debug";
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_QUERY_LIMIT;
  }
  return Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.trunc(limit)));
}

function encodeCursor(index: number): string {
  return Buffer.from(String(index), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = Number.parseInt(
      Buffer.from(cursor, "base64url").toString("utf8"),
      10
    );
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function rotateFiles(directory: string, maxFiles: number): Promise<void> {
  const oldestPath = path.join(directory, `${ACTIVE_LOG_FILENAME}.${maxFiles}`);
  await fs.rm(oldestPath, { force: true });

  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const from = path.join(directory, `${ACTIVE_LOG_FILENAME}.${index}`);
    const to = path.join(directory, `${ACTIVE_LOG_FILENAME}.${index + 1}`);
    try {
      await fs.rename(from, to);
    } catch {
      // ignore missing file
    }
  }

  const activePath = path.join(directory, ACTIVE_LOG_FILENAME);
  const rotatedPath = path.join(directory, `${ACTIVE_LOG_FILENAME}.1`);
  try {
    await fs.rename(activePath, rotatedPath);
  } catch {
    // ignore missing file
  }
}

export class FileSystemLogManager implements SystemLogManager {
  constructor(
    private readonly baseDirectory: string,
    private readonly options: {
      level?: SystemLogLevel;
      maxBytes?: number;
      maxFiles?: number;
    } = {}
  ) {}

  private get logsDirectory(): string {
    return path.resolve(this.baseDirectory, "logs");
  }

  private get activeLogPath(): string {
    return path.join(this.logsDirectory, ACTIVE_LOG_FILENAME);
  }

  private get minLevel(): SystemLogLevel {
    return this.options.level ?? "debug";
  }

  private get maxBytes(): number {
    return Math.max(1024, this.options.maxBytes ?? 1024 * 1024);
  }

  private get maxFiles(): number {
    return Math.max(1, this.options.maxFiles ?? 5);
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.logsDirectory, { recursive: true });
  }

  private shouldWrite(level: SystemLogLevel): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.minLevel];
  }

  async append(record: SystemLogRecord): Promise<void> {
    if (!this.shouldWrite(record.level)) {
      return;
    }

    await this.ensureDirectory();
    const nextRecord: SystemLogRecord = {
      timestamp: record.timestamp,
      level: record.level,
      component: record.component,
      event: record.event,
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      ...(typeof record.turnCount === "number"
        ? { turnCount: record.turnCount }
        : {}),
      ...(record.runId ? { runId: record.runId } : {}),
      ...(record.requestId ? { requestId: record.requestId } : {}),
      details: sanitizeValue(record.details)
    };
    const line = `${JSON.stringify(nextRecord)}\n`;

    try {
      const stat = await fs.stat(this.activeLogPath);
      if (stat.size + Buffer.byteLength(line, "utf8") > this.maxBytes) {
        await rotateFiles(this.logsDirectory, this.maxFiles);
      }
    } catch {
      // ignore missing active file
    }

    await fs.appendFile(this.activeLogPath, line, "utf8");
  }

  async query(input: SystemLogQuery = {}): Promise<SystemLogQueryResult> {
    await this.ensureDirectory();
    const limit = normalizeLimit(input.limit);
    const startIndex = decodeCursor(input.cursor) ?? 0;
    const filenames = [
      ACTIVE_LOG_FILENAME,
      ...Array.from(
        { length: this.maxFiles },
        (_, index) => `${ACTIVE_LOG_FILENAME}.${index + 1}`
      )
    ];

    const records: SystemLogRecord[] = [];
    for (const filename of filenames) {
      const filePath = path.join(this.logsDirectory, filename);
      let raw = "";
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch {
        continue;
      }

      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as SystemLogRecord;
          records.push(parsed);
        } catch {
          continue;
        }
      }
    }

    const filtered = records
      .filter((record) =>
        input.sessionId ? record.sessionId === input.sessionId : true
      )
      .filter((record) => (input.level ? record.level === input.level : true))
      .filter((record) =>
        input.component ? record.component === input.component : true
      )
      .filter((record) => (input.event ? record.event === input.event : true))
      .filter((record) => (input.runId ? record.runId === input.runId : true))
      .filter((record) =>
        input.requestId ? record.requestId === input.requestId : true
      )
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

    const page = filtered.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < filtered.length
        ? encodeCursor(startIndex + limit)
        : null;
    return { records: page, nextCursor };
  }
}

class SystemLogger implements Logger {
  constructor(
    private readonly manager: SystemLogManager,
    private readonly component: SystemLogComponent,
    private readonly context: LoggerContext = {}
  ) {}

  child(context: LoggerContext): Logger {
    return new SystemLogger(this.manager, this.component, {
      ...this.context,
      ...context
    });
  }

  async debug(event: string, details: JsonValue = null): Promise<void> {
    await this.write("debug", event, details);
  }

  async info(event: string, details: JsonValue = null): Promise<void> {
    await this.write("info", event, details);
  }

  async warn(event: string, details: JsonValue = null): Promise<void> {
    await this.write("warn", event, details);
  }

  async error(event: string, details: JsonValue = null): Promise<void> {
    await this.write("error", event, details);
  }

  private async write(
    level: SystemLogLevel,
    event: string,
    details: JsonValue
  ): Promise<void> {
    await this.manager.append({
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      event,
      ...(this.context.sessionId ? { sessionId: this.context.sessionId } : {}),
      ...(typeof this.context.turnCount === "number"
        ? { turnCount: this.context.turnCount }
        : {}),
      ...(this.context.runId ? { runId: this.context.runId } : {}),
      ...(this.context.requestId ? { requestId: this.context.requestId } : {}),
      details
    });
  }
}

export function createLogger(input: {
  manager: SystemLogManager;
  component: SystemLogComponent;
  context?: LoggerContext;
}): Logger {
  return new SystemLogger(input.manager, input.component, input.context);
}

export function createFileSystemLogManager(
  baseDirectory: string,
  env?: NodeJS.ProcessEnv
): FileSystemLogManager {
  const options: {
    level?: SystemLogLevel;
    maxBytes?: number;
    maxFiles?: number;
  } = {
    level: parseLevel(env?.SYSTEM_LOG_LEVEL)
  };

  if (env?.SYSTEM_LOG_MAX_BYTES) {
    options.maxBytes = Number(env.SYSTEM_LOG_MAX_BYTES);
  }
  if (env?.SYSTEM_LOG_MAX_FILES) {
    options.maxFiles = Number(env.SYSTEM_LOG_MAX_FILES);
  }

  return new FileSystemLogManager(baseDirectory, options);
}
