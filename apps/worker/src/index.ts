import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAgentRuntime,
  createDefaultToolRegistry,
  createFileSessionManager,
  createFileTraceManager,
  createMiniMaxRuntime,
  createPromptBuilder,
  resolveToolChoice,
  resolveSessionStateDirectory
} from "@ai-app-template/agent";

const logLevel = process.env.WORKER_LOG_LEVEL ?? "info";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stateDirectory = resolveSessionStateDirectory(workspaceRoot);
const sessionManager = createFileSessionManager(stateDirectory);
const traceManager = createFileTraceManager(stateDirectory);
const promptBuilder = createPromptBuilder();
const miniMaxRuntime = createMiniMaxRuntime(process.env);
const toolChoice = resolveToolChoice(process.env);
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30_000);
const staleSessionMs = Number(process.env.WORKER_STALE_SESSION_MS ?? 120_000);

console.log(`[worker] ready (logLevel=${logLevel})`);

function isRecoverableState(state: string, updatedAt: string): boolean {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return (
    ageMs >= staleSessionMs &&
    (state === "interrupted" || state === "waiting for tool result" || state === "running")
  );
}

async function recoverPendingSessions(): Promise<void> {
  if (!miniMaxRuntime) {
    console.log("[worker] MiniMax runtime not configured, waiting");
    return;
  }

  const sessions = await sessionManager.listSessions();
  for (const session of sessions) {
    if (!isRecoverableState(session.sessionState.loopState, session.updatedAt)) {
      continue;
    }

    console.log(`[worker] recovering session ${session.sessionId}`);
    const runtime = createAgentRuntime({
      client: miniMaxRuntime.client,
      model: session.model,
      sessionManager,
      toolRegistry: createDefaultToolRegistry({
        workingDirectory: session.workingDirectory
      }),
      traceManager,
      promptBuilder,
      maxTurns: 6,
      maxTokens: 512,
      ...(toolChoice ? { toolChoice } : {})
    });

    await runtime.run({
      sessionId: session.sessionId
    });
  }
}

void recoverPendingSessions();

const heartbeat = setInterval(() => {
  void recoverPendingSessions();
}, pollIntervalMs);

const shutdown = (signal: string) => {
  clearInterval(heartbeat);
  console.log(`[worker] shutting down on ${signal}`);
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
