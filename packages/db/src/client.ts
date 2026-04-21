import postgres from "postgres";
import type { Sql } from "postgres";

export const DATABASE_URL_ENV = "DATABASE_URL";

export type ProductDatabaseClient = Sql<Record<string, unknown>>;

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const databaseUrl = env[DATABASE_URL_ENV]?.trim();
  return databaseUrl ? databaseUrl : null;
}

export function createPostgresDatabase(
  connectionString: string
): ProductDatabaseClient {
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 5,
    prepare: false
  }) as ProductDatabaseClient;
}
