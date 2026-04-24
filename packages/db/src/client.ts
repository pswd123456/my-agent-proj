import postgres, { type Sql } from "postgres";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { productSchema, type ProductSchema } from "./schema.js";

export const DATABASE_URL_ENV = "DATABASE_URL";

export type ProductDatabaseConnection = Sql<Record<string, unknown>>;
export type ProductDatabaseClient = PostgresJsDatabase<ProductSchema> & {
  $client: ProductDatabaseConnection;
};

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const databaseUrl = env[DATABASE_URL_ENV]?.trim();
  return databaseUrl ? databaseUrl : null;
}

export function createPostgresConnection(
  connectionString: string
): ProductDatabaseConnection {
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 5,
    prepare: false
  }) as ProductDatabaseConnection;
}

export function createPostgresDatabase(
  connectionString: string
): ProductDatabaseClient {
  const client = createPostgresConnection(connectionString);
  return drizzle(client, { schema: productSchema }) as ProductDatabaseClient;
}
