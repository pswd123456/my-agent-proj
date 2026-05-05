import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPostgresConnection,
  resolveDatabaseUrl
} from "../packages/db/src/client.ts";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const managedPostgresDataDir = resolve(
  workspaceRoot,
  "tmp/postgres-local/data"
);
const managedPostgresLogFile = resolve(
  workspaceRoot,
  "tmp/postgres-local/server.log"
);

type DatabaseTarget = {
  databaseName: string;
  host: string;
  port: string;
  url: URL;
};

type ProbeResult =
  | {
      ok: true;
    }
  | {
      error: unknown;
      ok: false;
      summary: string;
    };

function log(message: string): void {
  console.log(`[dev:db] ${message}`);
}

function fail(message: string): never {
  throw new Error(`[dev:db] ${message}`);
}

function resolveExecutable(
  envName: string,
  fallbackNames: string[],
  knownPaths: string[]
): string | null {
  const candidates = [
    process.env[envName]?.trim(),
    ...fallbackNames,
    ...knownPaths
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      stdio: "pipe"
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function runCommand(command: string, args: string[], label: string): void {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.status === 0) {
    return;
  }

  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  fail(`${label} failed.${output ? `\n${output}` : ""}`);
}

function parseDatabaseTarget(databaseUrl: string): DatabaseTarget {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!databaseName) {
    fail("DATABASE_URL must include a database name.");
  }

  return {
    databaseName,
    host: url.hostname,
    port: url.port || "5432",
    url
  };
}

function describeTarget(target: DatabaseTarget): string {
  return `${target.host}:${target.port}/${target.databaseName}`;
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function buildMaintenanceUrl(target: DatabaseTarget): string {
  const maintenanceUrl = new URL(target.url.toString());
  maintenanceUrl.pathname = "/postgres";
  return maintenanceUrl.toString();
}

function withConnectTimeout(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has("connect_timeout")) {
    url.searchParams.set("connect_timeout", "2");
  }
  return url.toString();
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof error.code === "string"
        ? `${error.code}: `
        : "";
    return `${code}${error.message}`;
  }

  return String(error);
}

function isConnectionFailure(summary: string): boolean {
  const normalized = summary.toLowerCase();
  return (
    normalized.includes("econnrefused") ||
    normalized.includes("connection refused") ||
    normalized.includes("connect timeout") ||
    normalized.includes("connection terminated")
  );
}

async function probeDatabase(databaseUrl: string): Promise<ProbeResult> {
  const sql = createPostgresConnection(withConnectTimeout(databaseUrl));

  try {
    await sql`select 1`;
    return { ok: true };
  } catch (error) {
    return {
      error,
      ok: false,
      summary: summarizeError(error)
    };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

function ensureManagedDataDirectory(
  initdb: string,
  target: DatabaseTarget
): void {
  if (existsSync(resolve(managedPostgresDataDir, "PG_VERSION"))) {
    return;
  }

  if (
    existsSync(managedPostgresDataDir) &&
    readdirSync(managedPostgresDataDir).length > 0
  ) {
    fail(
      `${managedPostgresDataDir} exists but is not a PostgreSQL data directory.`
    );
  }

  mkdirSync(managedPostgresDataDir, { recursive: true });
  const username = decodeURIComponent(target.url.username || "postgres");
  log(
    `Initializing local PostgreSQL data directory at ${managedPostgresDataDir}.`
  );
  runCommand(
    initdb,
    [
      "-D",
      managedPostgresDataDir,
      "-U",
      username,
      "--auth=trust",
      "--encoding=UTF8"
    ],
    "initdb"
  );
}

function isManagedServerRunning(pgCtl: string): boolean {
  if (!existsSync(resolve(managedPostgresDataDir, "PG_VERSION"))) {
    return false;
  }

  const result = spawnSync(pgCtl, ["status", "-D", managedPostgresDataDir], {
    encoding: "utf8",
    stdio: "pipe"
  });
  return result.status === 0;
}

function resolveListenHost(host: string): string {
  return host === "[::1]" ? "::1" : host;
}

function startManagedPostgres(pgCtl: string, target: DatabaseTarget): void {
  if (isManagedServerRunning(pgCtl)) {
    fail(
      `Managed PostgreSQL is already running from ${managedPostgresDataDir}, but ${describeTarget(
        target
      )} is still unreachable. Check DATABASE_URL or restart the local database.`
    );
  }

  mkdirSync(dirname(managedPostgresLogFile), { recursive: true });
  const listenHost = resolveListenHost(target.host);
  log(
    `Starting local PostgreSQL at ${target.host}:${target.port} using ${managedPostgresDataDir}.`
  );
  runCommand(
    pgCtl,
    [
      "start",
      "-w",
      "-t",
      "20",
      "-D",
      managedPostgresDataDir,
      "-l",
      managedPostgresLogFile,
      "-o",
      `-p ${target.port} -h ${listenHost}`
    ],
    "pg_ctl start"
  );
}

async function ensureTargetDatabaseExists(
  target: DatabaseTarget
): Promise<void> {
  const maintenanceUrl = buildMaintenanceUrl(target);
  const sql = createPostgresConnection(withConnectTimeout(maintenanceUrl));

  try {
    const rows = await sql<{ exists: boolean }[]>`
      select exists(
        select 1 from pg_database where datname = ${target.databaseName}
      ) as "exists"
    `;

    if (rows[0]?.exists) {
      return;
    }

    log(`Creating local database ${target.databaseName}.`);
    await sql`create database ${sql(target.databaseName)}`;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

async function ensureDevDatabase(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl(process.env);
  if (!databaseUrl) {
    fail("DATABASE_URL is required before running bun dev.");
  }

  const target = parseDatabaseTarget(databaseUrl);
  const initialProbe = await probeDatabase(databaseUrl);
  if (initialProbe.ok) {
    log(`PostgreSQL is reachable at ${describeTarget(target)}.`);
    return;
  }

  if (!isLocalHost(target.host)) {
    fail(
      `Cannot reach PostgreSQL at ${describeTarget(
        target
      )}: ${initialProbe.summary}. Automatic startup only supports localhost DATABASE_URL values.`
    );
  }

  const maintenanceProbe = await probeDatabase(buildMaintenanceUrl(target));
  if (maintenanceProbe.ok) {
    await ensureTargetDatabaseExists(target);
  } else if (isConnectionFailure(maintenanceProbe.summary)) {
    const pgCtl = resolveExecutable(
      "PG_CTL",
      ["pg_ctl"],
      [
        "/opt/homebrew/bin/pg_ctl",
        "/opt/homebrew/opt/postgresql@17/bin/pg_ctl",
        "/usr/local/bin/pg_ctl",
        "/usr/local/opt/postgresql@17/bin/pg_ctl"
      ]
    );
    const initdb = resolveExecutable(
      "INITDB",
      ["initdb"],
      [
        "/opt/homebrew/bin/initdb",
        "/opt/homebrew/opt/postgresql@17/bin/initdb",
        "/usr/local/bin/initdb",
        "/usr/local/opt/postgresql@17/bin/initdb"
      ]
    );

    if (!pgCtl || !initdb) {
      fail(
        `Cannot reach PostgreSQL at ${describeTarget(
          target
        )}, and pg_ctl/initdb were not found. Install PostgreSQL or start the database manually.`
      );
    }

    ensureManagedDataDirectory(initdb, target);
    startManagedPostgres(pgCtl, target);
    await ensureTargetDatabaseExists(target);
  } else {
    fail(
      `Cannot prepare local PostgreSQL at ${describeTarget(
        target
      )}: ${maintenanceProbe.summary}`
    );
  }

  const finalProbe = await probeDatabase(databaseUrl);
  if (!finalProbe.ok) {
    fail(
      `PostgreSQL startup finished, but ${describeTarget(
        target
      )} is still unreachable: ${finalProbe.summary}`
    );
  }

  log(`PostgreSQL is ready at ${describeTarget(target)}.`);
}

try {
  await ensureDevDatabase();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
