import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createFileTraceManager,
  createMiniMaxRuntime,
  createPostgresSessionManager,
  createAgentRuntime,
  createDefaultToolRegistry,
  listSettingsPermissionToolOptions,
  createPromptBuilder,
  resolveSessionStateDirectory,
  resolveToolChoice
} from "../packages/agent/src/index.ts";
import {
  createMemoryRoutineRepository,
  createPostgresDatabase,
  createPostgresSettingsRepository,
  ensureProductSchema,
  resolveDatabaseUrl
} from "../packages/db/src/index.ts";
import { DEFAULT_SESSION_SETTINGS_USER_ID } from "../packages/domain/src/index.ts";

const miniMaxRuntime = createMiniMaxRuntime(process.env);
if (!miniMaxRuntime) {
  throw new Error(
    "Missing MiniMax runtime configuration. Set MINIMAX_API_KEY or ANTHROPIC_API_KEY."
  );
}

const databaseUrl = resolveDatabaseUrl(process.env);
if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL.");
}

const smokeRoot = path.join(process.cwd(), "tmp");
await mkdir(smokeRoot, { recursive: true });
const workspaceRoot = await mkdtemp(
  path.join(smokeRoot, "minimax-file-edit-smoke-")
);
const appDir = path.join(workspaceRoot, "apps/web/app/_components");
await mkdir(appDir, { recursive: true });

const repoAgentsPath = path.join(process.cwd(), "AGENTS.md");
const rootAgentsContent = await readFile(repoAgentsPath, "utf8");
await writeFile(path.join(workspaceRoot, "AGENTS.md"), rootAgentsContent, "utf8");
const repoAppsAgentsPath = path.join(process.cwd(), "apps/AGENTS.md");
const appsAgentsContent = await readFile(repoAppsAgentsPath, "utf8");
await writeFile(path.join(workspaceRoot, "apps/AGENTS.md"), appsAgentsContent, "utf8");

const targetPath = path.join(appDir, "session-workbench-conversation.tsx");
const initialContent = [
  'export function SessionWorkbenchConversation() {',
  "  return (",
  "    <div>",
  "      {true ? null : (",
  "        <div",
  '          className={getSoftBlockClass(',
  '            "py-6 text-sm text-[var(--app-text-muted)]"',
  "          )}",
  "        >",
  "          发送请求后，这里会显示当前会话的对话和执行记录。",
  "        </div>",
  "      )}",
  "    </div>",
  "  );",
  "}"
].join("\n");
await writeFile(targetPath, `${initialContent}\n`, "utf8");
const expectedContent = [
  'export function SessionWorkbenchConversation() {',
  "  return (",
  "    <div>",
  "      {true ? null : (",
  "        <div",
  '          className={getSoftBlockClass(',
  '            "py-6 text-sm text-[var(--app-text-muted)]"',
  "          )}",
  "        >",
  "        </div>",
  "      )}",
  "    </div>",
  "  );",
  "}"
].join("\n");

const stateDirectory = resolveSessionStateDirectory(workspaceRoot);
const traceManager = createFileTraceManager(stateDirectory);
const database = createPostgresDatabase(databaseUrl);
await ensureProductSchema(database);
const routineRepository = createMemoryRoutineRepository();
const sessionManager = createPostgresSessionManager(database);
const settingsPermissionToolOptions = listSettingsPermissionToolOptions({
  workingDirectory: workspaceRoot,
  routineRepository
}).map((tool) => tool.name);
const settingsRepository = createPostgresSettingsRepository(database, {
  settingsPermissionToolOptions
});
const settingsUserId =
  process.env.MINIMAX_FILE_EDIT_SMOKE_USER_ID?.trim() ||
  DEFAULT_SESSION_SETTINGS_USER_ID;
const userSettings = await settingsRepository.getOrCreate(settingsUserId);
const runtime = createAgentRuntime({
  client: miniMaxRuntime.client,
  model: miniMaxRuntime.model,
  sessionManager,
  routineRepository,
  toolRegistry: createDefaultToolRegistry({
    workingDirectory: workspaceRoot,
    routineRepository,
    enabledCapabilityPacks: ["workspace"]
  }),
  traceManager,
  promptBuilder: createPromptBuilder(),
  userCustomPrompt: "总是输出简体中文",
  maxTurns: 8,
  maxTokens: 1024,
  ...(resolveToolChoice(process.env)
    ? { toolChoice: resolveToolChoice(process.env) }
    : {})
});

const session = await runtime.createSession({
  workingDirectory: workspaceRoot,
  model: miniMaxRuntime.model,
  userId: settingsUserId,
  yoloMode: userSettings.yoloMode,
  shellAllowPatterns: userSettings.shellAllowPatterns,
  shellDenyPatterns: userSettings.shellDenyPatterns,
  toolAllowList: userSettings.toolAllowList,
  toolAskList: userSettings.toolAskList,
  toolDenyList: userSettings.toolDenyList,
  enabledCapabilityPacks: ["workspace"]
});
const sessionId = session.sessionId;
const userMessage = "发送请求后，这里会显示当前会话的对话和执行记录。\n这句话去掉";
const resumeMessage = "批准";
const maxAutoApprovals = 12;
const runResults = [];

let result = await runtime.run({
  sessionId: session.sessionId,
  message: userMessage
});
runResults.push(result);

let approvalCount = 0;
while (
  result.status === "waiting for input" &&
  result.session.context.pendingPermissionRequest &&
  approvalCount < maxAutoApprovals
) {
  approvalCount += 1;
  result = await runtime.run({
    sessionId,
    message: resumeMessage,
    permissionReply: true
  });
  runResults.push(result);
}

const allToolOutputs = runResults.flatMap((run) => run.toolOutputs);
const finalContent = await readFile(targetPath, "utf8");
const textRemoved = !finalContent.includes(
  "发送请求后，这里会显示当前会话的对话和执行记录。"
);
const classNamePreserved = finalContent.includes(
  '"py-6 text-sm text-[var(--app-text-muted)]"'
);
const controlFlowPreserved =
  finalContent.includes("      {true ? null : (") &&
  finalContent.includes("      )}") &&
  !finalContent.includes("{false ? (") &&
  !finalContent.includes(") : null}");
const exactContentMatch = finalContent === `${expectedContent}\n`;

const searchOutputs = allToolOutputs.filter(
  (output) => output.toolName === "search_text" && !output.isError
);
const searchErrors = allToolOutputs.filter(
  (output) => output.toolName === "search_text" && output.isError
);
const readOutputs = allToolOutputs.filter(
  (output) => output.toolName === "read_file" && !output.isError
);
const readErrors = allToolOutputs.filter(
  (output) => output.toolName === "read_file" && output.isError
);
const patchOutputs = allToolOutputs.filter(
  (output) => output.toolName === "apply_patch" && !output.isError
);
const patchErrors = allToolOutputs.filter(
  (output) => output.toolName === "apply_patch" && output.isError
);
const shellOutputs = allToolOutputs.filter(
  (output) => output.toolName === "run_shell_command"
);
const writeOutputs = allToolOutputs.filter(
  (output) => output.toolName === "write_file"
);
const patchDetails = patchOutputs[0]?.details;
const singleLineRemovalOnly =
  patchDetails?.kind === "workspace_file_changes" &&
  patchDetails.files.length === 1 &&
  patchDetails.files[0]?.addedLineCount === 0 &&
  patchDetails.files[0]?.removedLineCount === 1;
const tracePath = path.join(
  stateDirectory,
  "sessions",
  `${sessionId}.trace.jsonl`
);

const ok =
  result.status === "completed" &&
  textRemoved &&
  classNamePreserved &&
  controlFlowPreserved &&
  exactContentMatch &&
  searchOutputs.length >= 1 &&
  searchErrors.length === 0 &&
  readOutputs.length === 1 &&
  readErrors.length === 0 &&
  patchOutputs.length === 1 &&
  patchErrors.length === 0 &&
  shellOutputs.length === 0 &&
  writeOutputs.length === 0 &&
  singleLineRemovalOnly === true;

console.log(
  JSON.stringify(
    {
      ok,
      sessionId,
      workspaceRoot,
      stateDirectory,
      tracePath,
      settingsUserId,
      inheritedPermissionSettings: {
        yoloMode: userSettings.yoloMode,
        shellAllowPatterns: userSettings.shellAllowPatterns,
        shellDenyPatterns: userSettings.shellDenyPatterns,
        toolAllowList: userSettings.toolAllowList,
        toolAskList: userSettings.toolAskList,
        toolDenyList: userSettings.toolDenyList
      },
      approvalCount,
      maxAutoApprovals,
      status: result.status,
      finalAnswer: result.finalAnswer,
      runSummaries: runResults.map((run, index) => ({
        runIndex: index + 1,
        status: run.status,
        stopReason: run.stopReason,
        toolOutputs: run.toolOutputs.map((output) => ({
          toolName: output.toolName,
          isError: output.isError,
          displayText: output.displayText
        }))
      })),
      toolOutputs: allToolOutputs.map((output) => ({
        toolName: output.toolName,
        isError: output.isError,
        displayText: output.displayText,
        details: output.details
      })),
      textRemoved,
      classNamePreserved,
      controlFlowPreserved,
      exactContentMatch,
      searchCount: searchOutputs.length,
      singleLineRemovalOnly,
      finalContent,
      targetPath
    },
    null,
    2
  )
);

assert.equal(result.status, "completed");
assert.equal(textRemoved, true);
assert.equal(classNamePreserved, true);
assert.equal(controlFlowPreserved, true);
assert.equal(exactContentMatch, true);
assert.equal(searchOutputs.length >= 1, true);
assert.equal(searchErrors.length, 0);
assert.equal(readOutputs.length, 1);
assert.equal(readErrors.length, 0);
assert.equal(patchOutputs.length, 1);
assert.equal(patchErrors.length, 0);
assert.equal(shellOutputs.length, 0);
assert.equal(writeOutputs.length, 0);
assert.equal(singleLineRemovalOnly, true);
