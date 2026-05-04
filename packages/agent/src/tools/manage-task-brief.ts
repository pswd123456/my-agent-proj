import { createHash } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  describeTaskBriefBinding,
  normalizeTaskBriefPath,
  normalizeTaskBriefPlanName,
  readTaskBrief,
  resolveTaskBriefPath
} from "../session/task-brief.js";
import { createTaskBriefWriteAck } from "./planning-tool-result.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { writeTextFileAtomic } from "./workspace.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

const MAX_TASK_BRIEF_CHARACTERS = 20_000;
const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 100;

const readSchema = z
  .object({
    action: z.literal("read"),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().positive().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      typeof value.startLine === "number" &&
      typeof value.endLine === "number" &&
      value.endLine < value.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message: "endLine must be greater than or equal to startLine."
      });
    }
  });

const searchSchema = z
  .object({
    action: z.literal("search"),
    query: z.string().min(1),
    regex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional()
  })
  .strict();

const editSchema = z
  .object({
    action: z.literal("edit"),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    content: z.string()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endLine < value.startLine) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message: "endLine must be greater than or equal to startLine."
      });
    }
  });

const replaceSchema = z
  .object({
    action: z.literal("replace"),
    plan_name: z.string().min(1).optional(),
    content: z.string().min(1)
  })
  .strict();

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get") }).strict(),
  readSchema,
  searchSchema,
  editSchema,
  replaceSchema
]);

type ManageTaskBriefInput = z.infer<typeof schema>;

interface ReadWindowRequest {
  startLine: number;
  endLine: number | null;
}

function normalizeReadWindowRequest(
  input: Extract<ManageTaskBriefInput, { action: "read" }>
): ReadWindowRequest {
  if (typeof input.offset === "number" || typeof input.limit === "number") {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? null;
    return {
      startLine: offset + 1,
      endLine: limit === null ? null : offset + limit
    };
  }

  return {
    startLine: input.startLine ?? 1,
    endLine: input.endLine ?? null
  };
}

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function readLineRange(input: {
  content: string;
  startLine: number;
  endLine: number | null;
  maxCharacters: number;
}): {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
} {
  const lines = splitLines(input.content);
  const totalLines = lines.length;
  const normalizedEndLine = input.endLine ?? totalLines;
  const selectedLines = lines.slice(input.startLine - 1, normalizedEndLine);
  const selectedContent = selectedLines.join("\n");

  if (selectedContent.length <= input.maxCharacters) {
    return {
      content: selectedContent,
      startLine: input.startLine,
      endLine: Math.min(normalizedEndLine, totalLines),
      totalLines,
      truncated: false
    };
  }

  return {
    content: selectedContent.slice(0, input.maxCharacters),
    startLine: input.startLine,
    endLine: Math.min(normalizedEndLine, totalLines),
    totalLines,
    truncated: true
  };
}

function formatReadDisplayText(input: {
  path: string | null;
  exists: boolean;
  startLine: number | null;
  endLine: number | null;
  totalLines: number;
  truncated: boolean;
}): string {
  return [
    "[manage_task_brief] success",
    "- action: read",
    `- path: ${input.path ?? "none"}`,
    `- exists: ${input.exists ? "yes" : "no"}`,
    `- lines: ${
      input.startLine === null || input.endLine === null
        ? "none"
        : `${input.startLine}-${input.endLine}`
    }`,
    `- total lines: ${input.totalLines}`,
    `- truncated: ${input.truncated ? "yes" : "no"}`
  ].join("\n");
}

function detectNewline(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function splitEditableLines(content: string): string[] {
  return splitLines(content);
}

function splitReplacementLines(content: string): string[] {
  return splitLines(content);
}

function hasFinalNewline(content: string): boolean {
  return content.endsWith("\n");
}

function applyLineEdit(input: {
  originalContent: string;
  startLine: number;
  endLine: number;
  replacement: string;
}): { content: string; replacedLineCount: number; newLineCount: number } {
  const lines = splitEditableLines(input.originalContent);
  const replacementLines = splitReplacementLines(input.replacement);
  const newline = detectNewline(input.originalContent);
  const before = lines.slice(0, input.startLine - 1);
  const after = lines.slice(input.endLine);
  const nextLines = [...before, ...replacementLines, ...after];
  const nextContent = `${nextLines.join(newline)}${
    hasFinalNewline(input.originalContent) || input.replacement.endsWith("\n")
      ? newline
      : ""
  }`;

  return {
    content: nextContent,
    replacedLineCount: input.endLine - input.startLine + 1,
    newLineCount: replacementLines.length
  };
}

function createLineDiff(input: {
  path: string;
  originalLines: string[];
  replacementLines: string[];
  startLine: number;
}): string {
  const oldCount = input.originalLines.length;
  const newCount = input.replacementLines.length;
  const lines = [
    `--- ${input.path}`,
    `+++ ${input.path}`,
    `@@ -${input.startLine},${oldCount} +${input.startLine},${newCount} @@`,
    ...input.originalLines.map((line) => `- ${line}`),
    ...input.replacementLines.map((line) => `+ ${line}`)
  ];
  const diff = lines.join("\n");

  return diff.length > 12_000
    ? `${diff.slice(0, 12_000)}\n...[truncated]`
    : diff;
}

async function getBoundTaskBriefPath(
  context: Parameters<RuntimeTool["execute"]>[1],
  planName: string | undefined
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const binding = describeTaskBriefBinding({
    workingDirectory: context.workingDirectory,
    sessionId: context.sessionId,
    taskBriefPath: context.sessionContext.taskBriefPath
  });

  if (binding.state === "bound_named" && binding.path) {
    if (typeof planName === "string" && planName.trim().length > 0) {
      const normalizedPlanName = normalizeTaskBriefPlanName(planName);
      if (!normalizedPlanName) {
        return {
          ok: false,
          message: "The provided plan_name is invalid."
        };
      }
      const nextPath = resolveTaskBriefPath(
        context.workingDirectory,
        context.sessionId,
        normalizedPlanName
      );
      if (binding.path !== nextPath) {
        return {
          ok: false,
          message:
            "This session already has a named task brief path. Omit plan_name or reuse the existing plan name."
        };
      }
    }

    return { ok: true, path: binding.path };
  }

  if (binding.state === "invalid") {
    return {
      ok: false,
      message: "The bound task brief path is invalid for the current session."
    };
  }

  if (!context.sessionContext.planModeEnabled) {
    return {
      ok: false,
      message: "This session does not have a bound task brief path yet."
    };
  }

  if (typeof planName !== "string" || planName.trim().length === 0) {
    return {
      ok: false,
      message:
        "This session does not have a bound task brief path yet. Provide plan_name when creating the first task brief."
    };
  }
  const normalizedPlanName = normalizeTaskBriefPlanName(planName);
  if (!normalizedPlanName) {
    return {
      ok: false,
      message: "The provided plan_name is invalid."
    };
  }

  const nextPath = resolveTaskBriefPath(
    context.workingDirectory,
    context.sessionId,
    normalizedPlanName
  );
  await context.sessionManager.updateContext(context.sessionId, {
    taskBriefPath: nextPath
  });
  context.sessionContext.taskBriefPath = nextPath;
  return { ok: true, path: nextPath };
}

function executeGet(context: Parameters<RuntimeTool["execute"]>[1]) {
  const brief = readTaskBrief(
    context.sessionContext.taskBriefPath,
    MAX_TASK_BRIEF_CHARACTERS
  );

  return successResult(
    createToolResult({
      ok: true,
      code: "TASK_BRIEF_READ",
      message: brief.exists
        ? "Read the current session task brief."
        : "The current session task brief file does not exist yet.",
      data: {
        path: brief.path,
        exists: brief.exists,
        content: brief.content,
        truncated: brief.truncated
      }
    }),
    [
      "[manage_task_brief] success",
      "- action: get",
      `- path: ${brief.path ?? "none"}`,
      `- exists: ${brief.exists ? "yes" : "no"}`,
      `- truncated: ${brief.truncated ? "yes" : "no"}`
    ].join("\n")
  );
}

function executeRead(
  input: Extract<ManageTaskBriefInput, { action: "read" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  const normalizedPath = normalizeTaskBriefPath(
    context.sessionContext.taskBriefPath
  );
  const window = normalizeReadWindowRequest(input);

  if (!normalizedPath) {
    return successResult(
      createToolResult({
        ok: true,
        code: "TASK_BRIEF_READ",
        message: "The current session does not have a bound task brief path.",
        data: {
          path: null,
          exists: false,
          content: null,
          startLine: null,
          endLine: null,
          totalLines: 0,
          truncated: false
        }
      }),
      formatReadDisplayText({
        path: null,
        exists: false,
        startLine: null,
        endLine: null,
        totalLines: 0,
        truncated: false
      })
    );
  }

  try {
    const content = readFileSync(normalizedPath, "utf8");
    const range = readLineRange({
      content,
      startLine: window.startLine,
      endLine: window.endLine,
      maxCharacters: MAX_TASK_BRIEF_CHARACTERS
    });

    return successResult(
      createToolResult({
        ok: true,
        code: "TASK_BRIEF_READ",
        message: "Read the current session task brief.",
        data: {
          path: normalizedPath,
          exists: true,
          content: range.content,
          startLine: range.startLine,
          endLine: range.endLine,
          totalLines: range.totalLines,
          truncated: range.truncated
        }
      }),
      formatReadDisplayText({
        path: normalizedPath,
        exists: true,
        startLine: range.startLine,
        endLine: range.endLine,
        totalLines: range.totalLines,
        truncated: range.truncated
      })
    );
  } catch {
    return successResult(
      createToolResult({
        ok: true,
        code: "TASK_BRIEF_READ",
        message: "The current session task brief file does not exist yet.",
        data: {
          path: normalizedPath,
          exists: false,
          content: null,
          startLine: null,
          endLine: null,
          totalLines: 0,
          truncated: false
        }
      }),
      formatReadDisplayText({
        path: normalizedPath,
        exists: false,
        startLine: null,
        endLine: null,
        totalLines: 0,
        truncated: false
      })
    );
  }
}

function executeSearch(
  input: Extract<ManageTaskBriefInput, { action: "search" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  const normalizedPath = normalizeTaskBriefPath(
    context.sessionContext.taskBriefPath
  );
  if (!normalizedPath) {
    return successResult(
      createToolResult({
        ok: true,
        code: "TASK_BRIEF_SEARCHED",
        message: "The current session does not have a bound task brief path.",
        data: {
          path: null,
          exists: false,
          query: input.query,
          regex: input.regex ?? false,
          caseSensitive: input.caseSensitive ?? false,
          matches: [],
          truncated: false
        }
      }),
      [
        "[manage_task_brief] success",
        "- action: search",
        "- path: none",
        "- exists: no",
        "- matches: 0",
        "- truncated: no"
      ].join("\n")
    );
  }

  let content: string;
  try {
    content = readFileSync(normalizedPath, "utf8");
  } catch {
    return successResult(
      createToolResult({
        ok: true,
        code: "TASK_BRIEF_SEARCHED",
        message: "The current session task brief file does not exist yet.",
        data: {
          path: normalizedPath,
          exists: false,
          query: input.query,
          regex: input.regex ?? false,
          caseSensitive: input.caseSensitive ?? false,
          matches: [],
          truncated: false
        }
      }),
      [
        "[manage_task_brief] success",
        "- action: search",
        `- path: ${normalizedPath}`,
        "- exists: no",
        "- matches: 0",
        "- truncated: no"
      ].join("\n")
    );
  }

  const flags = input.caseSensitive ? "" : "i";
  let matcher: RegExp;
  if (input.regex) {
    try {
      matcher = new RegExp(input.query, flags);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid regular expression.";
      return failureResult(
        createToolResult({
          ok: false,
          code: "INVALID_TOOL_INPUT",
          message
        }),
        `[manage_task_brief] invalid input\n- ${message}`
      );
    }
  } else {
    const escaped = input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matcher = new RegExp(escaped, flags);
  }

  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;
  const lines = splitLines(content);
  const matches: Array<{ line: number; snippet: string }> = [];
  for (const [index, line] of lines.entries()) {
    if (!matcher.test(line)) {
      continue;
    }
    matches.push({
      line: index + 1,
      snippet: line
    });
    if (matches.length >= maxResults) {
      break;
    }
  }

  const totalMatchCount = lines.reduce((count, line) => {
    if (matcher.global || matcher.sticky) {
      matcher.lastIndex = 0;
    }
    return matcher.test(line) ? count + 1 : count;
  }, 0);
  const truncated = totalMatchCount > matches.length;

  return successResult(
    createToolResult({
      ok: true,
      code: "TASK_BRIEF_SEARCHED",
      message: "Searched the current session task brief.",
      data: {
        path: normalizedPath,
        exists: true,
        query: input.query,
        regex: input.regex ?? false,
        caseSensitive: input.caseSensitive ?? false,
        matches,
        truncated
      }
    }),
    [
      "[manage_task_brief] success",
      "- action: search",
      `- path: ${normalizedPath}`,
      "- exists: yes",
      `- matches: ${matches.length}`,
      `- truncated: ${truncated ? "yes" : "no"}`
    ].join("\n")
  );
}

async function executeEdit(
  input: Extract<ManageTaskBriefInput, { action: "edit" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  const taskBriefPath = normalizeTaskBriefPath(
    context.sessionContext.taskBriefPath
  );
  if (!taskBriefPath) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "TASK_BRIEF_PATH_UNAVAILABLE",
        message:
          "This session does not have a bound task brief path yet. Create the first brief with manage_task_brief action=replace."
      }),
      [
        "[manage_task_brief] failed",
        "- action: edit",
        "- no bound task brief path",
        "- create the first brief with action=replace"
      ].join("\n")
    );
  }

  let originalContent: string;
  let originalStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    originalStat = await fs.stat(taskBriefPath);
    originalContent = await fs.readFile(taskBriefPath, "utf8");
  } catch {
    return failureResult(
      createToolResult({
        ok: false,
        code: "TASK_BRIEF_NOT_FOUND",
        message:
          "The current task brief file does not exist yet. Create it with manage_task_brief action=replace first."
      }),
      [
        "[manage_task_brief] failed",
        "- action: edit",
        "- task brief file does not exist yet",
        "- create it with action=replace first"
      ].join("\n")
    );
  }

  const lines = splitEditableLines(originalContent);
  const totalLines = lines.length;
  if (input.startLine > totalLines || input.endLine > totalLines) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "LINE_RANGE_OUT_OF_BOUNDS",
        message: "Line range is outside the task brief.",
        data: {
          path: taskBriefPath,
          totalLines
        }
      }),
      [
        "[manage_task_brief] failed",
        "- action: edit",
        "- line range is outside the task brief",
        `- total lines: ${totalLines}`
      ].join("\n")
    );
  }

  const edit = applyLineEdit({
    originalContent,
    startLine: input.startLine,
    endLine: input.endLine,
    replacement: input.content
  });
  const originalLines = lines.slice(input.startLine - 1, input.endLine);
  const replacementLines = splitReplacementLines(input.content);
  const diff = createLineDiff({
    path: taskBriefPath,
    originalLines,
    replacementLines,
    startLine: input.startLine
  });

  await writeTextFileAtomic(taskBriefPath, edit.content, {
    mode: originalStat.mode
  });
  const hash = createHash("sha256").update(edit.content).digest("hex");

  return successResult(
    createToolResult({
      ok: true,
      code: "TASK_BRIEF_EDITED",
      message: "Edited the current session task brief.",
      data: {
        path: taskBriefPath,
        startLine: input.startLine,
        endLine: input.endLine,
        replacedLineCount: edit.replacedLineCount,
        newLineCount: edit.newLineCount,
        hash,
        diff
      }
    }),
    [
      "[manage_task_brief] success",
      "- action: edit",
      `- path: ${taskBriefPath}`,
      `- lines: ${input.startLine}-${input.endLine}`
    ].join("\n"),
    {
      kind: "task_brief",
      path: taskBriefPath,
      content: edit.content,
      operation: "edit",
      startLine: input.startLine,
      endLine: input.endLine
    }
  );
}

async function executeReplace(
  input: Extract<ManageTaskBriefInput, { action: "replace" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  const boundPath = await getBoundTaskBriefPath(context, input.plan_name);
  if (!boundPath.ok) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "TASK_BRIEF_PATH_UNAVAILABLE",
        message: boundPath.message
      }),
      `[manage_task_brief] failed\n- action: replace\n- ${boundPath.message}`
    );
  }

  try {
    await fs.mkdir(path.dirname(boundPath.path), { recursive: true });
    await writeTextFileAtomic(boundPath.path, input.content);
    const data = createTaskBriefWriteAck({
      path: boundPath.path
    });

    return successResult(
      createToolResult({
        ok: true,
        code: "TASK_BRIEF_REPLACED",
        message: "Replaced the current session task brief.",
        data
      }),
      [
        "[manage_task_brief] success",
        "- action: replace",
        `- path: ${boundPath.path}`
      ].join("\n"),
      {
        kind: "task_brief",
        path: boundPath.path,
        content: input.content,
        operation: "replace"
      }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to replace the task brief.";
    return failureResult(
      createToolResult({
        ok: false,
        code: "TASK_BRIEF_WRITE_FAILED",
        message
      }),
      `[manage_task_brief] failed\n- action: replace\n- ${message}`
    );
  }
}

export function createManageTaskBriefTool(): RuntimeTool {
  return {
    name: "manage_task_brief",
    description: buildToolDescription({
      usageScenarios: [
        "Read, search, edit, or replace the current session task brief.",
        "Maintain plan-mode task context through one structured task brief tool."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "action",
          type: '"get" | "read" | "search" | "edit" | "replace"',
          required: true,
          description: "Choose the task brief operation."
        }),
        "Use action=get to load the full bound task brief snapshot.",
        "Use action=read with startLine/endLine or offset/limit for a narrow window.",
        "Use action=search to locate line numbers before action=read or action=edit.",
        "Use action=edit for focused line-range edits inside an existing brief.",
        "Use action=replace to create the first brief or fully rewrite it; include plan_name on the first write."
      ],
      constraints: [
        "Choose exactly one line-window syntax for action=read: either {startLine,endLine} or {offset,limit}.",
        "action=edit requires an existing bound task brief path and an in-range inclusive line span.",
        "When the session does not have a bound task brief path yet, action=replace requires plan_name.",
        "Use this tool only for task brief writes; do not use shell redirection or workspace file mutation tools to write the task brief."
      ],
      examples: [
        '{"action":"get"}',
        '{"action":"read","startLine":1,"endLine":40}',
        '{"action":"search","query":"migration","maxResults":10}',
        '{"action":"edit","startLine":3,"endLine":5,"content":"Updated scope\\nUpdated risks"}',
        '{"action":"replace","plan_name":"plugin_rollout","content":"# Goal\\nImplement the first plugin end to end.\\n"}'
      ]
    }),
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "get" }
          },
          required: ["action"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "read" },
            offset: { type: "number" },
            limit: { type: "number" },
            startLine: { type: "number" },
            endLine: { type: "number" }
          },
          required: ["action"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "search" },
            query: { type: "string" },
            regex: { type: "boolean" },
            caseSensitive: { type: "boolean" },
            maxResults: { type: "number" }
          },
          required: ["action", "query"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "edit" },
            startLine: { type: "number" },
            endLine: { type: "number" },
            content: { type: "string" }
          },
          required: ["action", "startLine", "endLine", "content"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "replace" },
            plan_name: { type: "string" },
            content: { type: "string" }
          },
          required: ["action", "content"],
          additionalProperties: false
        }
      ]
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("manage_task_brief", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      if (parsed.data.action === "get") {
        return executeGet(context);
      }
      if (parsed.data.action === "read") {
        return executeRead(parsed.data, context);
      }
      if (parsed.data.action === "search") {
        return executeSearch(parsed.data, context);
      }
      if (parsed.data.action === "edit") {
        return executeEdit(parsed.data, context);
      }
      return executeReplace(parsed.data, context);
    }
  };
}
