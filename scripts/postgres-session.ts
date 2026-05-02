import { createPostgresSessionManager } from "../packages/agent/src/index.ts";
import {
  createPostgresDatabase,
  ensureProductSchema,
  resolveDatabaseUrl
} from "../packages/db/src/index.ts";

export async function createScriptPostgresSessionManager() {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required because session persistence uses PostgreSQL."
    );
  }

  const database = createPostgresDatabase(databaseUrl);
  await ensureProductSchema(database);

  return {
    database,
    sessionManager: createPostgresSessionManager(database)
  };
}
