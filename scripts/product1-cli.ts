import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

import {
  createAgentRuntime,
  createScheduleToolRegistry,
  createFileTraceManager,
  createMiniMaxRuntime,
  createPostgresSessionManager,
  createPromptBuilder,
  resolveSessionStateDirectory,
  resolveToolChoice
} from "../packages/agent/src/index.ts";
import {
  createPostgresDatabase,
  createPostgresRoutineRepository,
  ensureProductSchema,
  resolveDatabaseUrl
} from "../packages/db/src/index.ts";

const miniMaxRuntime = createMiniMaxRuntime(process.env);
if (!miniMaxRuntime) {
  console.error(
    "Missing MiniMax runtime configuration. Set MINIMAX_API_KEY or ANTHROPIC_API_KEY."
  );
  process.exit(1);
}

const databaseUrl = resolveDatabaseUrl(process.env);
if (!databaseUrl) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const stateDirectory = resolveSessionStateDirectory(workspaceRoot);
const traceManager = createFileTraceManager(stateDirectory);
const database = createPostgresDatabase(databaseUrl);
await ensureProductSchema(database);
const routineRepository = createPostgresRoutineRepository(database);
const sessionManager = createPostgresSessionManager(database);
const runtime = createAgentRuntime({
  client: miniMaxRuntime.client,
  model: miniMaxRuntime.model,
  sessionManager,
  routineRepository,
  toolRegistry: createScheduleToolRegistry({ routineRepository }),
  traceManager,
  promptBuilder: createPromptBuilder(),
  maxTurns: 6,
  maxTokens: 512,
  ...(resolveToolChoice(process.env) ? { toolChoice: resolveToolChoice(process.env) } : {})
});

let session = await runtime.createSession({
  workingDirectory: workspaceRoot,
  model: miniMaxRuntime.model,
  userId: process.env.PRODUCT1_USER_ID ?? "cli-user"
});

const cli = readline.createInterface({ input, output });

console.log(`product1 cli ready (session=${session.sessionId})`);
console.log("Type your routine request. Type 'exit' to quit.");

while (true) {
  const prompt =
    session.context.status === "waiting_for_conflict_confirmation" ? "confirm> " : "> ";
  const message = (await cli.question(prompt)).trim();
  if (!message) {
    continue;
  }

  if (message === "exit" || message === "quit") {
    break;
  }

  const result = await runtime.run({
    sessionId: session.sessionId,
    message
  });
  session = result.session;

  for (const toolOutput of result.toolOutputs) {
    console.log(toolOutput.displayText);
  }

  if (result.finalAnswer) {
    console.log(result.finalAnswer);
  }
}

await cli.close();
