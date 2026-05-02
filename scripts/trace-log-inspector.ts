import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSessionStateDirectory } from "../packages/agent/src/index.ts";
import { buildPromptRequestMessages } from "../packages/agent/src/prompt.ts";
import type { TraceEvent, TraceRecord } from "../packages/agent/src/trace.ts";

type IncludeSection =
  | "prompt"
  | "response"
  | "thinking"
  | "tool-input"
  | "tool-output"
  | "permissions"
  | "background"
  | "compaction"
  | "logs"
  | "raw-errors";

type Command = "inspect" | "list";

interface CliOptions {
  command: Command;
  sessionId?: string;
  latest: boolean;
  listLimit: number;
  turns: Set<number>;
  toolName?: string;
  include: Set<IncludeSection>;
  errorsOnly: boolean;
  maxChars: number;
  logLimit: number;
  stateDir?: string;
}

interface ToolCallSummary {
  id: string;
  turnCount: number;
  name: string;
  input: Record<string, unknown>;
  calledAt: string;
  resultAt?: string;
  output?: string;
  displayText?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface TurnSummary {
  sequence: number;
  turnCount: number;
  observedTurnCounts: Set<number>;
  startedAt?: string;
  endedAt?: string;
  loopState?: string;
  stopReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  prompt?: Extract<TraceEvent, { kind: "prompt" }>;
  records: TraceRecord[];
  tools: ToolCallSummary[];
  permissionEvents: string[];
  userQuestions: string[];
  backgroundNotifications: string[];
  backgroundNotificationsConsumed: string[];
  fallbacks: string[];
  compactions: string[];
  runErrors: string[];
}

export interface RunSummary {
  sequence: number;
  runId?: string;
  isLegacy: boolean;
  records: TraceRecord[];
  turns: TurnSummary[];
  startedAt?: string;
  endedAt?: string;
}

interface SystemLogRecord {
  timestamp: string;
  level: string;
  component: string;
  event: string;
  sessionId?: string;
  turnCount?: number;
  runId?: string;
  requestId?: string;
  details: unknown;
}

const INCLUDE_VALUES: IncludeSection[] = [
  "prompt",
  "response",
  "thinking",
  "tool-input",
  "tool-output",
  "permissions",
  "background",
  "compaction",
  "logs",
  "raw-errors"
];

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

function printHelp(): void {
  console.log(`my-agent-proj trace/log inspector

Usage:
  bun scripts/trace-log-inspector.ts list [--limit 10] [--state-dir PATH]
  bun scripts/trace-log-inspector.ts inspect [--latest | --session SESSION_ID]
      [--turn 3 --turn 4] [--tool TOOL_NAME]
      [--include prompt,tool-output,logs]
      [--errors-only] [--max-chars 1200] [--log-limit 50]
  bun run trace:inspect -- inspect --latest --include logs

Behavior:
  - inspect defaults to the latest trace when --session is omitted
  - --session accepts a full session id or a unique prefix
  - default output is a compact overview plus per-turn timeline
  - use --include to expand only the sections you need

Include values:
  ${INCLUDE_VALUES.join(", ")}
`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    fail(`Invalid number for ${flag}: ${value}`);
  }
  return parsed;
}

function parseTurns(value: string): number[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseNumber(entry, "--turn"));
}

function parseInclude(value: string): Set<IncludeSection> {
  const include = new Set<IncludeSection>();
  for (const entry of value.split(",")) {
    const normalized = entry.trim() as IncludeSection;
    if (!normalized) {
      continue;
    }
    if (!INCLUDE_VALUES.includes(normalized)) {
      fail(`Unknown include section: ${entry}`);
    }
    include.add(normalized);
  }
  return include;
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  let command: Command = "inspect";
  const args = [...argv];
  if (args[0] === "inspect" || args[0] === "list") {
    command = args.shift() as Command;
  }

  const options: CliOptions = {
    command,
    latest: false,
    listLimit: 10,
    turns: new Set<number>(),
    include: new Set<IncludeSection>(),
    errorsOnly: false,
    maxChars: 1200,
    logLimit: 50
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) {
      break;
    }

    switch (arg) {
      case "--session": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --session");
        }
        options.sessionId = value;
        break;
      }
      case "--latest":
        options.latest = true;
        break;
      case "--limit": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --limit");
        }
        options.listLimit = parseNumber(value, "--limit");
        break;
      }
      case "--turn": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --turn");
        }
        for (const turn of parseTurns(value)) {
          options.turns.add(turn);
        }
        break;
      }
      case "--tool": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --tool");
        }
        options.toolName = value;
        break;
      }
      case "--include": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --include");
        }
        options.include = parseInclude(value);
        break;
      }
      case "--errors-only":
        options.errorsOnly = true;
        break;
      case "--max-chars": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --max-chars");
        }
        options.maxChars = parseNumber(value, "--max-chars");
        break;
      }
      case "--log-limit": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --log-limit");
        }
        options.logLimit = parseNumber(value, "--log-limit");
        break;
      }
      case "--state-dir": {
        const value = args.shift();
        if (!value) {
          fail("Missing value for --state-dir");
        }
        options.stateDir = path.resolve(value);
        break;
      }
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  if (options.command === "inspect" && !options.sessionId && !options.latest) {
    options.latest = true;
  }

  return options;
}

function getStateDirectory(options: CliOptions): string {
  return options.stateDir ?? resolveSessionStateDirectory(workspaceRoot);
}

async function listTraceFiles(stateDirectory: string): Promise<string[]> {
  const sessionsDirectory = path.join(stateDirectory, "sessions");
  try {
    const entries = await fs.readdir(sessionsDirectory, {
      withFileTypes: true
    });
    const files = await Promise.all(
      entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".trace.jsonl")
        )
        .map(async (entry) => {
          const filePath = path.join(sessionsDirectory, entry.name);
          const stat = await fs.stat(filePath);
          return {
            filePath,
            mtimeMs: stat.mtimeMs
          };
        })
    );
    return files
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .map((entry) => entry.filePath);
  } catch {
    return [];
  }
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function resolveTraceFile(
  stateDirectory: string,
  options: CliOptions
): Promise<string> {
  const traceFiles = await listTraceFiles(stateDirectory);
  if (traceFiles.length === 0) {
    fail(`No trace files found under ${path.join(stateDirectory, "sessions")}`);
  }

  if (options.latest) {
    return traceFiles[0]!;
  }

  if (!options.sessionId) {
    fail("Missing session id.");
  }

  const sessionId = options.sessionId;
  const exactName = `${sessionId}.trace.jsonl`;
  const exactMatch = traceFiles.find(
    (filePath) => path.basename(filePath) === exactName
  );
  if (exactMatch) {
    return exactMatch;
  }

  const prefixMatches = traceFiles.filter((filePath) =>
    path.basename(filePath).startsWith(sessionId)
  );
  if (prefixMatches.length === 1) {
    return prefixMatches[0]!;
  }
  if (prefixMatches.length > 1) {
    fail(
      `Session prefix ${sessionId} is ambiguous:\n${prefixMatches
        .slice(0, 10)
        .map((filePath) => `  - ${path.basename(filePath, ".trace.jsonl")}`)
        .join("\n")}`
    );
  }

  fail(`No trace found for session ${sessionId}`);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

function jsonText(value: unknown, maxChars: number): string {
  if (typeof value === "string") {
    return truncate(value, maxChars);
  }
  return truncate(JSON.stringify(value, null, 2), maxChars);
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || Number.isNaN(ms)) {
    return "-";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function extractTextParts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (
      entry &&
      typeof entry === "object" &&
      "type" in entry &&
      entry.type === "text" &&
      "text" in entry &&
      typeof entry.text === "string"
    ) {
      return [entry.text];
    }
    return [];
  });
}

function firstUserMessage(records: TraceRecord[]): string | null {
  const promptRecord = records.find((record) => record.event.kind === "prompt");
  if (!promptRecord || promptRecord.event.kind !== "prompt") {
    return null;
  }

  for (const message of promptRecord.event.messages) {
    if (message.role !== "user") {
      continue;
    }
    const text = extractTextParts(message.content).join("\n").trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function isSelectedTurn(turnCount: number, options: CliOptions): boolean {
  return options.turns.size === 0 || options.turns.has(turnCount);
}

function isSelectedTool(toolName: string, options: CliOptions): boolean {
  return !options.toolName || options.toolName === toolName;
}

function isErrorLikeTurn(turn: TurnSummary): boolean {
  return (
    turn.runErrors.length > 0 ||
    turn.fallbacks.length > 0 ||
    turn.permissionEvents.some(
      (entry) =>
        entry.includes("permission_blocked") ||
        entry.includes("permission_rejected")
    ) ||
    turn.tools.some((tool) => tool.isError)
  );
}

export function buildTurnSummaries(records: TraceRecord[]): TurnSummary[] {
  const turns: TurnSummary[] = [];
  const toolIndex = new Map<string, ToolCallSummary>();
  let currentTurn: TurnSummary | null = null;

  function createTurn(turnCount: number): TurnSummary {
    const created: TurnSummary = {
      sequence: turns.length + 1,
      turnCount,
      observedTurnCounts: new Set([turnCount]),
      records: [],
      tools: [],
      permissionEvents: [],
      userQuestions: [],
      backgroundNotifications: [],
      backgroundNotificationsConsumed: [],
      fallbacks: [],
      compactions: [],
      runErrors: []
    };
    turns.push(created);
    return created;
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const event = record.event;
    const shouldMergeIntoCurrentTurn =
      currentTurn !== null &&
      event.kind === "turn_start" &&
      currentTurn.startedAt === undefined &&
      currentTurn.turnCount === event.turnCount;
    const shouldStartNewTurn =
      currentTurn === null ||
      (!shouldMergeIntoCurrentTurn && event.kind === "turn_start") ||
      (event.turnCount !== currentTurn.turnCount &&
        currentTurn.endedAt !== undefined);
    const turn = shouldStartNewTurn
      ? createTurn(event.turnCount)
      : currentTurn;
    currentTurn = turn;
    turn.observedTurnCounts.add(event.turnCount);
    turn.records.push(record);

    switch (event.kind) {
      case "turn_start":
        turn.startedAt = record.createdAt;
        break;
      case "turn_end":
        turn.endedAt = record.createdAt;
        turn.loopState = event.loopState;
        break;
      case "response":
        turn.stopReason = event.stopReason;
        turn.inputTokens = event.usage.inputTokens;
        turn.outputTokens = event.usage.outputTokens;
        turn.cacheReadInputTokens = event.usage.cacheReadInputTokens;
        turn.cacheCreationInputTokens = event.usage.cacheCreationInputTokens;
        break;
      case "prompt":
        turn.prompt = event;
        break;
      case "tool_call": {
        const tool: ToolCallSummary = {
          id: event.toolCallId,
          turnCount: event.turnCount,
          name: event.toolName,
          input: event.input,
          calledAt: record.createdAt
        };
        turn.tools.push(tool);
        toolIndex.set(tool.id, tool);
        break;
      }
      case "tool_result": {
        const tool = toolIndex.get(event.toolCallId);
        if (!tool) {
          break;
        }
        tool.resultAt = record.createdAt;
        tool.output = event.output;
        tool.displayText = event.displayText;
        tool.isError = event.isError;
        const duration =
          new Date(record.createdAt).getTime() -
          new Date(tool.calledAt).getTime();
        if (Number.isFinite(duration) && duration >= 0) {
          tool.durationMs = duration;
        }
        break;
      }
      case "permission_request":
        turn.permissionEvents.push(
          `permission_request ${event.toolName}: ${event.request.summaryText}`
        );
        break;
      case "permission_approved":
        turn.permissionEvents.push(`permission_approved ${event.toolName}`);
        break;
      case "permission_rejected":
        turn.permissionEvents.push(`permission_rejected ${event.toolName}`);
        break;
      case "permission_blocked":
        turn.permissionEvents.push(
          `permission_blocked ${event.toolName}: ${event.reason}`
        );
        break;
      case "user_question_request":
        turn.userQuestions.push(event.question.question);
        break;
      case "background_notification":
        turn.backgroundNotifications.push(jsonText(event.notification, 300));
        break;
      case "background_notification_consumed":
        turn.backgroundNotificationsConsumed.push(
          jsonText(event.notification, 300)
        );
        break;
      case "fallback":
        turn.fallbacks.push(`${event.reason}: ${event.summary}`);
        break;
      case "history_compaction":
        turn.compactions.push(
          `history_compaction ${event.estimatedInputTokensBefore} -> ${event.estimatedInputTokensAfter}`
        );
        break;
      case "full_compaction":
        turn.compactions.push(
          `full_compaction ${event.estimatedInputTokensBefore} -> ${event.estimatedInputTokensAfter}`
        );
        break;
      case "run_error":
        turn.runErrors.push(event.error);
        break;
      default:
        break;
    }
  }

  return turns;
}

function shouldStartNewLegacyRun(
  currentRun: Pick<RunSummary, "records">,
  record: TraceRecord
): boolean {
  if (currentRun.records.length === 0) {
    return false;
  }

  if (record.event.kind !== "turn_start") {
    return false;
  }

  const lastTurnStart = [...currentRun.records]
    .reverse()
    .find((candidate) => candidate.event.kind === "turn_start");
  if (!lastTurnStart) {
    return false;
  }

  const lastObservedTurnCount = lastTurnStart.event.turnCount;
  return record.event.turnCount <= lastObservedTurnCount;
}

export function buildRunSummaries(records: TraceRecord[]): RunSummary[] {
  const runs: RunSummary[] = [];
  let currentRun: RunSummary | null = null;

  const createRun = (record: TraceRecord): RunSummary => {
    const created: RunSummary = {
      sequence: runs.length + 1,
      runId: record.runId,
      isLegacy: !record.runId,
      records: [],
      turns: []
    };
    runs.push(created);
    return created;
  };

  for (const record of records) {
    const shouldStartNewRun =
      currentRun === null ||
      record.runId !== currentRun.runId ||
      (record.runId === undefined &&
        currentRun.runId === undefined &&
        shouldStartNewLegacyRun(currentRun, record));

    if (shouldStartNewRun) {
      currentRun = createRun(record);
    }

    currentRun.records.push(record);
  }

  for (const run of runs) {
    run.turns = buildTurnSummaries(run.records);
    run.startedAt = run.records[0]?.createdAt;
    run.endedAt = run.records.at(-1)?.createdAt;
  }

  return runs;
}

async function readSystemLogs(
  stateDirectory: string,
  sessionId: string
): Promise<SystemLogRecord[]> {
  const logsDirectory = path.join(stateDirectory, "logs");
  try {
    const entries = await fs.readdir(logsDirectory, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) => entry.isFile() && entry.name.startsWith("system.log.jsonl")
      )
      .map((entry) => path.join(logsDirectory, entry.name));
    const records = (
      await Promise.all(
        files.map((filePath) => readJsonLines<SystemLogRecord>(filePath))
      )
    ).flat();
    return records
      .filter((record) => record.sessionId === sessionId)
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  } catch {
    return [];
  }
}

async function commandList(options: CliOptions): Promise<void> {
  const stateDirectory = getStateDirectory(options);
  const traceFiles = await listTraceFiles(stateDirectory);
  if (traceFiles.length === 0) {
    console.log(
      `No trace files found under ${path.join(stateDirectory, "sessions")}`
    );
    return;
  }

  const selected = traceFiles.slice(0, options.listLimit);
  console.log(
    `Recent trace sessions (${selected.length}/${traceFiles.length}) in ${path.join(
      stateDirectory,
      "sessions"
    )}`
  );

  for (const filePath of selected) {
    const records = await readJsonLines<TraceRecord>(filePath);
    const stat = await fs.stat(filePath);
    const sessionId = path.basename(filePath, ".trace.jsonl");
    const runs = buildRunSummaries(records);
    const turns = runs.flatMap((run) => run.turns);
    const firstMessage = firstUserMessage(records);
    const lastTurn = turns.at(-1);
    const errorTurns = turns.filter(isErrorLikeTurn).length;
    const sizeKb = Math.round(stat.size / 1024);
    console.log(`\n- session ${sessionId}`);
    console.log(
      `  updated: ${formatTime(new Date(stat.mtimeMs).toISOString())}`
    );
    console.log(
      `  size: ${sizeKb}KB, events: ${records.length}, runs: ${runs.length}, turns: ${turns.length}, error_turns: ${errorTurns}`
    );
    console.log(
      `  last_state: ${lastTurn?.loopState ?? "-"}, last_stop_reason: ${lastTurn?.stopReason ?? "-"}`
    );
    if (firstMessage) {
      console.log(`  first_user_message: ${truncate(firstMessage, 140)}`);
    }
  }
}

function printOverview(
  records: TraceRecord[],
  runs: RunSummary[],
  traceFile: string,
  stateDirectory: string
): void {
  const sessionId =
    records[0]?.sessionId ?? path.basename(traceFile, ".trace.jsonl");
  const firstTurnStart = records.find(
    (record) => record.event.kind === "turn_start"
  );
  const totalEventsByKind = new Map<string, number>();
  for (const record of records) {
    totalEventsByKind.set(
      record.event.kind,
      (totalEventsByKind.get(record.event.kind) ?? 0) + 1
    );
  }
  const eventCountText = Array.from(totalEventsByKind.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([kind, count]) => `${kind}:${count}`)
    .join(", ");

  console.log(`Session: ${sessionId}`);
  console.log(`Trace file: ${traceFile}`);
  console.log(`State dir: ${stateDirectory}`);
  console.log(`Events: ${records.length}`);
  console.log(`Runs: ${runs.length}`);
  console.log(`Turns: ${runs.reduce((sum, run) => sum + run.turns.length, 0)}`);
  console.log(`Started: ${formatTime(firstTurnStart?.createdAt)}`);
  if (firstTurnStart?.event.kind === "turn_start") {
    console.log(`Model: ${firstTurnStart.event.session.model}`);
    console.log(
      `Working directory: ${firstTurnStart.event.session.workingDirectory}`
    );
  }
  const firstMessage = firstUserMessage(records);
  if (firstMessage) {
    console.log(`First user message: ${truncate(firstMessage, 200)}`);
  }
  console.log(
    `Recorded turn values by run: ${runs
      .map((run) => {
        const label = run.runId ? run.runId : `legacy-${run.sequence}`;
        const turns = run.turns
          .map((turn) => Array.from(turn.observedTurnCounts).join("/"))
          .join(" -> ");
        return `${label}[${turns}]`;
      })
      .join(" -> ")}`
  );
  const explicitRunIds = runs
    .map((run) => run.runId)
    .filter((runId): runId is string => typeof runId === "string");
  if (explicitRunIds.length > 0) {
    console.log(`Run IDs: ${explicitRunIds.join(", ")}`);
  }
  console.log(`Event counts: ${eventCountText}`);
}

function getVisibleTurns(run: RunSummary, options: CliOptions): TurnSummary[] {
  return run.turns.filter((turn) => isSelectedTurnSummary(turn, options));
}

function formatRunLabel(run: RunSummary): string {
  return run.runId ? `run ${run.runId}` : `legacy run ${run.sequence}`;
}

function printTimeline(runs: RunSummary[], options: CliOptions): void {
  const visibleRuns = runs
    .map((run) => ({
      run,
      turns: getVisibleTurns(run, options)
    }))
    .filter(({ turns }) => turns.length > 0);

  console.log("\nTimeline:");
  if (visibleRuns.length === 0) {
    console.log("  (no runs matched the current filters)");
    return;
  }

  for (const { run, turns } of visibleRuns) {
    console.log(
      `  Run ${run.sequence} (${formatRunLabel(run)}): ${formatTime(run.startedAt)} -> ${formatTime(run.endedAt)}`
    );
    for (const turn of turns) {
      const promptStats = turn.prompt?.compositionStats;
      const observedTurnText = Array.from(turn.observedTurnCounts).join("/");
      console.log(
        `    Turn ${turn.sequence} (recorded ${observedTurnText}): ${formatTime(turn.startedAt)} -> ${formatTime(turn.endedAt)}`
      );
      console.log(
        `      stop_reason=${turn.stopReason ?? "-"} loop_state=${turn.loopState ?? "-"} tokens=${turn.inputTokens ?? "-"} in / ${turn.outputTokens ?? "-"} out`
      );
      if (promptStats) {
        console.log(
          `      prompt_chars total=${promptStats.totalChars} conversation=${promptStats.conversationChars} runtime=${promptStats.runtimeContextChars} tools=${promptStats.toolDefinitionChars}`
        );
      }
      if (turn.tools.length > 0) {
        const tools = turn.tools
          .filter((tool) => isSelectedTool(tool.name, options))
          .map((tool) => {
            const status = tool.isError
              ? "error"
              : tool.resultAt
                ? "ok"
                : "pending";
            return `${tool.name}[${status}](${formatDuration(tool.durationMs)})`;
          });
        if (tools.length > 0) {
          console.log(`      tools: ${tools.join(", ")}`);
        }
      }
      if (turn.permissionEvents.length > 0) {
        console.log(`      permissions: ${turn.permissionEvents.join(" | ")}`);
      }
      if (turn.userQuestions.length > 0) {
        console.log(`      user_questions: ${turn.userQuestions.join(" | ")}`);
      }
      if (turn.backgroundNotifications.length > 0) {
        console.log(
          `      background_notifications: ${turn.backgroundNotifications.length}`
        );
      }
      if (turn.backgroundNotificationsConsumed.length > 0) {
        console.log(
          `      background_notifications_consumed: ${turn.backgroundNotificationsConsumed.length}`
        );
      }
      if (turn.compactions.length > 0) {
        console.log(`      compaction: ${turn.compactions.join(" | ")}`);
      }
      if (turn.fallbacks.length > 0) {
        console.log(`      fallbacks: ${turn.fallbacks.join(" | ")}`);
      }
      if (turn.runErrors.length > 0) {
        console.log(`      run_errors: ${turn.runErrors.join(" | ")}`);
      }
    }
  }
}

function isSelectedTurnSummary(turn: TurnSummary, options: CliOptions): boolean {
  if (
    options.turns.size > 0 &&
    !Array.from(turn.observedTurnCounts).some((turnCount) =>
      isSelectedTurn(turnCount, options)
    )
  ) {
    return false;
  }
  if (
    options.toolName &&
    !turn.tools.some((tool) => tool.name === options.toolName)
  ) {
    return false;
  }
  if (options.errorsOnly && !isErrorLikeTurn(turn)) {
    return false;
  }
  return true;
}

function printDetailedEvents(runs: RunSummary[], options: CliOptions): void {
  if (options.include.size === 0) {
    return;
  }

  const shouldPrintRecord = (record: TraceRecord): boolean => {
    switch (record.event.kind) {
      case "prompt":
        return options.include.has("prompt");
      case "response":
        return options.include.has("response");
      case "thinking":
        return options.include.has("thinking");
      case "tool_call":
        return (
          options.include.has("tool-input") &&
          isSelectedTool(record.event.toolName, options)
        );
      case "tool_result":
        return (
          options.include.has("tool-output") &&
          isSelectedTool(record.event.toolName, options)
        );
      case "permission_request":
      case "permission_approved":
      case "permission_rejected":
      case "permission_blocked":
      case "user_question_request":
        return options.include.has("permissions");
      case "background_notification":
      case "background_notification_consumed":
        return options.include.has("background");
      case "history_compaction":
      case "full_compaction":
        return options.include.has("compaction");
      case "run_error":
        return options.include.has("raw-errors");
      default:
        return false;
    }
  };

  const selected = runs
    .flatMap((run) => getVisibleTurns(run, options))
    .flatMap((turn) => turn.records)
    .filter(shouldPrintRecord);
  if (selected.length === 0) {
    console.log("\nExpanded sections: no matching records");
    return;
  }

  console.log("\nExpanded sections:");
  for (const record of selected) {
    const runText = record.runId ? `run ${record.runId} ` : "";
    const header = `  [${runText}turn ${record.event.turnCount}] ${record.event.kind} @ ${formatTime(record.createdAt)}`;
    console.log(header);
    switch (record.event.kind) {
      case "prompt":
        const requestMessages =
          record.event.requestMessages ??
          buildPromptRequestMessages(record.event);
        const requestMessagesLabel = record.event.requestMessages
          ? "model_request_messages"
          : "model_request_messages_reconstructed";
        console.log(`    cache_key: ${record.event.cacheKey}`);
        console.log(
          `    tool_count: ${record.event.tools.length}, tool_choice: ${jsonText(record.event.toolChoice, options.maxChars)}`
        );
        console.log(
          `    system:\n${indentBlock(truncate(record.event.system, options.maxChars), 6)}`
        );
        console.log(
          `    runtime_context:\n${indentBlock(jsonText(record.event.runtimeContextMessages, options.maxChars), 6)}`
        );
        console.log(
          `    ${requestMessagesLabel}:\n${indentBlock(jsonText(requestMessages, options.maxChars), 6)}`
        );
        console.log(
          `    messages:\n${indentBlock(jsonText(record.event.messages, options.maxChars), 6)}`
        );
        break;
      case "response":
        console.log(
          `    usage: in=${record.event.usage.inputTokens}, out=${record.event.usage.outputTokens}, cache_read=${record.event.usage.cacheReadInputTokens}, cache_create=${record.event.usage.cacheCreationInputTokens}`
        );
        console.log(
          `    content:\n${indentBlock(jsonText(record.event.content, options.maxChars), 6)}`
        );
        break;
      case "thinking":
        console.log(
          `    thinking:\n${indentBlock(truncate(record.event.text, options.maxChars), 6)}`
        );
        break;
      case "tool_call":
        console.log(
          `    tool ${record.event.toolName} (${record.event.toolCallId}) input:\n${indentBlock(jsonText(record.event.input, options.maxChars), 6)}`
        );
        break;
      case "tool_result":
        console.log(
          `    tool ${record.event.toolName} (${record.event.toolCallId}) is_error=${record.event.isError}`
        );
        if (record.event.displayText) {
          console.log(
            `    display_text:\n${indentBlock(truncate(record.event.displayText, options.maxChars), 6)}`
          );
        }
        console.log(
          `    output:\n${indentBlock(truncate(record.event.output, options.maxChars), 6)}`
        );
        break;
      case "permission_request":
        console.log(
          `    request:\n${indentBlock(jsonText(record.event.request, options.maxChars), 6)}`
        );
        break;
      case "permission_approved":
      case "permission_rejected":
        console.log(
          `    request:\n${indentBlock(jsonText(record.event.request, options.maxChars), 6)}`
        );
        break;
      case "permission_blocked":
        console.log(`    reason: ${record.event.reason}`);
        break;
      case "user_question_request":
        console.log(
          `    question:\n${indentBlock(jsonText(record.event.question, options.maxChars), 6)}`
        );
        break;
      case "background_notification":
      case "background_notification_consumed":
        console.log(
          `    payload:\n${indentBlock(jsonText(record.event.notification, options.maxChars), 6)}`
        );
        break;
      case "history_compaction":
      case "full_compaction":
        console.log(
          `    payload:\n${indentBlock(jsonText(record.event, options.maxChars), 6)}`
        );
        break;
      case "run_error":
        console.log(
          `    error:\n${indentBlock(jsonText(record.event, options.maxChars), 6)}`
        );
        break;
      default:
        break;
    }
  }
}

function indentBlock(text: string, spaces: number): string {
  const indent = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function printLogs(logs: SystemLogRecord[], options: CliOptions): void {
  if (!options.include.has("logs")) {
    return;
  }

  console.log(
    `\nSystem logs (${Math.min(logs.length, options.logLimit)}/${logs.length}):`
  );
  if (logs.length === 0) {
    console.log("  (no matching system logs)");
    return;
  }

  for (const record of logs.slice(0, options.logLimit)) {
    const turnText =
      typeof record.turnCount === "number" ? ` turn=${record.turnCount}` : "";
    const runText = record.runId ? ` run=${record.runId}` : "";
    console.log(
      `  ${formatTime(record.timestamp)} [${record.level}] ${record.component}.${record.event}${turnText}${runText}`
    );
    console.log(indentBlock(jsonText(record.details, options.maxChars), 4));
  }
}

async function commandInspect(options: CliOptions): Promise<void> {
  const stateDirectory = getStateDirectory(options);
  const traceFile = await resolveTraceFile(stateDirectory, options);
  const records = await readJsonLines<TraceRecord>(traceFile);
  if (records.length === 0) {
    fail(`Trace file is empty or unreadable: ${traceFile}`);
  }

  const runs = buildRunSummaries(records);
  const sessionId =
    records[0]?.sessionId ?? path.basename(traceFile, ".trace.jsonl");
  const logs = await readSystemLogs(stateDirectory, sessionId);

  printOverview(records, runs, traceFile, stateDirectory);
  printTimeline(runs, options);
  printDetailedEvents(runs, options);
  printLogs(logs, options);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  if (options.command === "list") {
    await commandList(options);
    return;
  }

  await commandInspect(options);
}

if (import.meta.main) {
  await main();
}
