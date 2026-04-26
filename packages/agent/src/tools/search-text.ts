import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { JsonValue } from "../types.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  assessRepeatedWorkspaceActivity,
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  walkFiles
} from "./workspace.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 200;
const MAX_OFFSET_LIMIT = 1_000;
const MAX_CONTEXT_LINES = 6;
const RG_TIMEOUT_MS = 1_500;
const IGNORED_PATH_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  "dist",
  "node_modules",
  "coverage"
]);

type SearchMatch = {
  path: string;
  line: number;
  snippet: string;
  contextBefore?: string[];
  contextAfter?: string[];
};

type SearchResult = {
  matches: SearchMatch[];
  engine: "rg" | "node";
  truncated: boolean;
};

type SearchOutputMode = "content" | "files_only" | "count";

function parseLiteralTerms(query: string): string[] {
  const terms: string[] = [];
  let current = "";

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    const nextCharacter = query[index + 1];

    if (
      character === "\\" &&
      (nextCharacter === "|" || nextCharacter === "\\")
    ) {
      current += nextCharacter;
      index += 1;
      continue;
    }

    if (character === "|") {
      const trimmed = current.trim();
      if (trimmed) {
        terms.push(trimmed);
      }
      current = "";
      continue;
    }

    current += character;
  }

  const trimmed = current.trim();
  if (trimmed) {
    terms.push(trimmed);
  }

  return terms.length > 0 ? terms : [query];
}

function shouldIgnorePath(filePath: string): boolean {
  const segments = filePath.split(/[\\/]+/).filter(Boolean);
  return segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
}

function normalizeMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(Math.floor(value), MAX_RESULTS_LIMIT);
}

function normalizeOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.min(Math.floor(value), MAX_OFFSET_LIMIT);
}

function normalizeContextLines(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.min(Math.floor(value), MAX_CONTEXT_LINES);
}

function normalizeOutputMode(value: unknown): SearchOutputMode {
  return value === "files_only" || value === "count" ? value : "content";
}

function normalizeFileGlob(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function globToRegExp(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? "";
    const nextCharacter = pattern[index + 1];

    if (character === "*") {
      if (nextCharacter === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      expression += ".";
      continue;
    }

    expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  expression += "$";
  return new RegExp(expression);
}

function matchesFileGlob(
  filePath: string,
  fileGlob: string | null,
  workingDirectory: string
): boolean {
  if (!fileGlob) {
    return true;
  }

  return globToRegExp(fileGlob).test(
    toRelativeWorkspacePath(workingDirectory, filePath)
  );
}

function matchesLiteralLine(
  line: string,
  literalTerms: string[],
  caseSensitive: boolean
): boolean {
  if (caseSensitive) {
    return literalTerms.some((term) => line.includes(term));
  }

  const normalizedLine = line.toLowerCase();
  return literalTerms.some((term) =>
    normalizedLine.includes(term.toLowerCase())
  );
}

function groupFiles(matches: SearchMatch[]): Array<{
  path: string;
  matchCount: number;
}> {
  return Object.entries(
    matches.reduce<Record<string, number>>((accumulator, match) => {
      accumulator[match.path] = (accumulator[match.path] ?? 0) + 1;
      return accumulator;
    }, {})
  ).map(([filePath, matchCount]) => ({
    path: filePath,
    matchCount
  }));
}

function sortMatches(matches: SearchMatch[]): SearchMatch[] {
  return [...matches].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line
  );
}

function ensureValidRegex(query: string, caseSensitive: boolean): string | null {
  try {
    new RegExp(query, caseSensitive ? "" : "i");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid regular expression.";
  }
}

function buildResultData(input: {
  workingDirectory: string;
  absoluteRoot: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  fileGlob: string | null;
  offset: number;
  contextLines: number;
  outputMode: SearchOutputMode;
  searchResult: SearchResult;
  warnings: string[];
}): Record<string, JsonValue> {
  const files = groupFiles(input.searchResult.matches);

  return {
    root: toRelativeWorkspacePath(input.workingDirectory, input.absoluteRoot),
    query: input.query,
    regex: input.regex,
    caseSensitive: input.caseSensitive,
    fileGlob: input.fileGlob,
    offset: input.offset,
    contextLines: input.contextLines,
    outputMode: input.outputMode,
    engine: input.searchResult.engine,
    truncated: input.searchResult.truncated,
    matchCount: input.searchResult.matches.length,
    fileCount: files.length,
    ...(input.outputMode === "content"
      ? { matches: input.searchResult.matches }
      : {}),
    ...(input.outputMode === "files_only" ? { files } : {}),
    ...(input.warnings.length > 0 ? { warnings: input.warnings } : {})
  };
}

function runRipgrep(input: {
  workingDirectory: string;
  absoluteRoot: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  fileGlob: string | null;
  literalTerms: string[];
  maxResults: number;
  offset: number;
  abortSignal?: AbortSignal;
}): Promise<SearchResult | null> {
  return new Promise((resolve, reject) => {
    const requestedMatches = input.maxResults + input.offset + 1;
    const args = [
      "--line-number",
      "--with-filename",
      "--no-heading",
      "--hidden",
      "--color",
      "never",
      "--max-filesize",
      "1M",
      "--max-count",
      String(requestedMatches),
      "--glob",
      "!.git/**",
      "--glob",
      "!**/.git/**",
      "--glob",
      "!.next/**",
      "--glob",
      "!**/.next/**",
      "--glob",
      "!.turbo/**",
      "--glob",
      "!**/.turbo/**",
      "--glob",
      "!dist/**",
      "--glob",
      "!**/dist/**",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!**/node_modules/**",
      "--glob",
      "!coverage/**",
      "--glob",
      "!**/coverage/**",
      input.absoluteRoot
    ];

    if (!input.caseSensitive) {
      args.unshift("--ignore-case");
    }
    if (input.fileGlob) {
      args.splice(args.length - 1, 0, "--glob", input.fileGlob);
    }
    if (!input.regex) {
      args.unshift("--fixed-strings");
      const patterns =
        input.literalTerms.length > 0 ? input.literalTerms : [input.query];
      for (const pattern of [...patterns].reverse()) {
        args.unshift(pattern);
        args.unshift("-e");
      }
    } else {
      args.splice(args.length - 1, 0, input.query);
    }

    const child = spawn("rg", args, {
      cwd: input.workingDirectory,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", abort);
    };
    const finish = (value: SearchResult | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      child.kill("SIGTERM");
      fail(new Error("Search cancelled."));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, RG_TIMEOUT_MS);

    input.abortSignal?.addEventListener("abort", abort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => {
      finish(null);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      if (code !== 0 && code !== 1) {
        finish(null);
        return;
      }

      const parsedMatches: SearchMatch[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line) {
          continue;
        }
        const firstSeparator = line.indexOf(":");
        if (firstSeparator < 0) {
          continue;
        }
        const secondSeparator = line.indexOf(":", firstSeparator + 1);
        if (secondSeparator < 0) {
          continue;
        }

        const lineNumber = Number.parseInt(
          line.slice(firstSeparator + 1, secondSeparator),
          10
        );
        if (!Number.isInteger(lineNumber)) {
          continue;
        }

        parsedMatches.push({
          path: toRelativeWorkspacePath(
            input.workingDirectory,
            line.slice(0, firstSeparator)
          ),
          line: lineNumber,
          snippet: line.slice(secondSeparator + 1).trim()
        });
        if (parsedMatches.length >= requestedMatches) {
          break;
        }
      }

      if (stderr && code !== 1 && parsedMatches.length === 0) {
        finish(null);
        return;
      }

      const sortedMatches = sortMatches(parsedMatches);
      finish({
        matches: sortedMatches.slice(
          input.offset,
          input.offset + input.maxResults
        ),
        engine: "rg",
        truncated: sortedMatches.length > input.offset + input.maxResults
      });
    });
  });
}

async function searchWithNode(input: {
  workingDirectory: string;
  absoluteRoot: string;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  fileGlob: string | null;
  literalTerms: string[];
  maxResults: number;
  offset: number;
}): Promise<SearchResult> {
  const rootStat = await fs.stat(input.absoluteRoot);
  const files = rootStat.isFile()
    ? [input.absoluteRoot]
    : await walkFiles(input.absoluteRoot, 2_000);
  const pattern = input.regex
    ? new RegExp(input.query, input.caseSensitive ? "" : "i")
    : null;
  const requestedMatches = input.maxResults + input.offset + 1;
  const matches: SearchMatch[] = [];

  for (const filePath of files) {
    if (matches.length >= requestedMatches) {
      break;
    }
    if (shouldIgnorePath(filePath)) {
      continue;
    }
    if (!matchesFileGlob(filePath, input.fileGlob, input.workingDirectory)) {
      continue;
    }

    const stat = await fs.stat(filePath);
    if (stat.size > 1_000_000) {
      continue;
    }

    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (typeof line !== "string") {
        continue;
      }

      if (
        pattern
          ? !pattern.test(line)
          : !matchesLiteralLine(line, input.literalTerms, input.caseSensitive)
      ) {
        continue;
      }

      matches.push({
        path: toRelativeWorkspacePath(input.workingDirectory, filePath),
        line: index + 1,
        snippet: line.trim()
      });
      if (matches.length >= requestedMatches) {
        break;
      }
    }
  }

  const sortedMatches = sortMatches(matches);
  return {
    matches: sortedMatches.slice(input.offset, input.offset + input.maxResults),
    engine: "node",
    truncated: sortedMatches.length > input.offset + input.maxResults
  };
}

async function attachContextLines(input: {
  workingDirectory: string;
  matches: SearchMatch[];
  contextLines: number;
}): Promise<SearchMatch[]> {
  if (input.contextLines <= 0 || input.matches.length === 0) {
    return input.matches;
  }

  const fileCache = new Map<string, string[]>();
  const enrichedMatches: SearchMatch[] = [];

  for (const match of input.matches) {
    const absolutePath = path.resolve(input.workingDirectory, match.path);
    let lines = fileCache.get(absolutePath);
    if (!lines) {
      const text = await fs.readFile(absolutePath, "utf8");
      lines =
        text.length === 0
          ? []
          : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
      fileCache.set(absolutePath, lines);
    }

    const startIndex = Math.max(0, match.line - input.contextLines - 1);
    const endIndex = Math.min(lines.length, match.line + input.contextLines);
    enrichedMatches.push({
      ...match,
      contextBefore: lines.slice(startIndex, match.line - 1),
      contextAfter: lines.slice(match.line, endIndex)
    });
  }

  return enrichedMatches;
}

export function createSearchTextTool(workingDirectory: string): RuntimeTool {
  return {
    name: "search_text",
    description:
      "Search for a text fragment within workspace files, a subdirectory, or a single file. Use this first to locate relevant content before a narrow read_file call.",
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Text fragment to look for. In literal mode, use | to match any of multiple keywords, and escape \\| for a literal pipe."
        },
        path: {
          type: "string",
          description:
            "Optional path relative to the workspace root. May point to a directory or a single file."
        },
        regex: {
          type: "boolean",
          description:
            "Treat query as a regular expression instead of a literal string."
        },
        fileGlob: {
          type: "string",
          description: "Optional glob filter for matched files."
        },
        caseSensitive: {
          type: "boolean",
          description:
            "Whether the search should respect case. Defaults to true."
        },
        maxResults: {
          type: "number",
          description: "Optional result limit."
        },
        offset: {
          type: "number",
          description: "Optional number of initial matches to skip."
        },
        contextLines: {
          type: "number",
          description: "Optional number of surrounding lines to include."
        },
        outputMode: {
          type: "string",
          enum: ["content", "files_only", "count"],
          description: "Choose detailed matches, file summaries, or counts only."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : "."
      ];
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (!(typeof input.query === "string" && input.query.trim())) {
        issues.push({
          field: "query",
          issue: "query is required."
        });
      }
      if (
        input.maxResults !== undefined &&
        (typeof input.maxResults !== "number" ||
          !Number.isFinite(input.maxResults) ||
          input.maxResults <= 0)
      ) {
        issues.push({
          field: "maxResults",
          issue: "maxResults must be a positive number."
        });
      }
      if (
        input.offset !== undefined &&
        (typeof input.offset !== "number" ||
          !Number.isFinite(input.offset) ||
          input.offset < 0)
      ) {
        issues.push({
          field: "offset",
          issue: "offset must be a non-negative number."
        });
      }
      if (
        input.contextLines !== undefined &&
        (typeof input.contextLines !== "number" ||
          !Number.isFinite(input.contextLines) ||
          input.contextLines < 0)
      ) {
        issues.push({
          field: "contextLines",
          issue: "contextLines must be a non-negative number."
        });
      }
      if (
        input.outputMode !== undefined &&
        input.outputMode !== "content" &&
        input.outputMode !== "files_only" &&
        input.outputMode !== "count"
      ) {
        issues.push({
          field: "outputMode",
          issue: "outputMode must be one of: content, files_only, count."
        });
      }

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      return { ok: true, value: input };
    },
    async execute(input, context) {
      const query = typeof input.query === "string" ? input.query.trim() : "";

      if (!query) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing search query.",
            validationErrors: [
              {
                field: "query",
                issue: "query is required."
              }
            ]
          }),
          "[search_text] invalid input\n- query: query is required."
        );
      }

      const searchRoot =
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : ".";
      const regex = input.regex === true;
      const caseSensitive =
        typeof input.caseSensitive === "boolean" ? input.caseSensitive : true;
      const fileGlob = normalizeFileGlob(input.fileGlob);
      const literalTerms = regex ? [] : parseLiteralTerms(query);
      const maxResults = normalizeMaxResults(input.maxResults);
      const offset = normalizeOffset(input.offset);
      const contextLines = normalizeContextLines(input.contextLines);
      const outputMode = normalizeOutputMode(input.outputMode);

      try {
        if (regex) {
          const invalidRegexMessage = ensureValidRegex(query, caseSensitive);
          if (invalidRegexMessage) {
            return failureResult(
              createToolResult({
                ok: false,
                code: "INVALID_REGEX",
                message: invalidRegexMessage
              }),
              `[search_text] failed\n- invalid regex: ${invalidRegexMessage}`
            );
          }
        }

        const repeatedActivity = assessRepeatedWorkspaceActivity({
          toolName: "search_text",
          toolInput: input,
          workingDirectory,
          sessionMessages: context.sessionMessages
        });
        if (repeatedActivity.shouldBlock) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "REPEATED_WORKSPACE_ACCESS_BLOCKED",
              message:
                "Repeated search_text calls for the same target were blocked to stop a loop.",
              data: {
                repeatCount: repeatedActivity.repeatCount
              }
            }),
            `[search_text] blocked\n- repeated searches detected (${repeatedActivity.repeatCount} recent attempts)`
          );
        }

        const absoluteRoot = normalizeWorkspacePath(
          workingDirectory,
          searchRoot,
          context.allowWorkspaceEscape
        );
        const ripgrepInput = {
          workingDirectory,
          absoluteRoot,
          query,
          regex,
          caseSensitive,
          fileGlob,
          literalTerms,
          maxResults,
          offset,
          ...(context.abortSignal ? { abortSignal: context.abortSignal } : {})
        };
        const rawSearchResult =
          (await runRipgrep(ripgrepInput)) ??
          (await searchWithNode({
            workingDirectory,
            absoluteRoot,
            query,
            regex,
            caseSensitive,
            fileGlob,
            literalTerms,
            maxResults,
            offset
          }));
        const searchResult = {
          ...rawSearchResult,
          matches: await attachContextLines({
            workingDirectory,
            matches: rawSearchResult.matches,
            contextLines
          })
        };
        const warnings = repeatedActivity.shouldWarn
          ? [
              `Repeated searches of the same target were detected (${repeatedActivity.repeatCount} recent attempts).`
            ]
          : [];

        return successResult(
          createToolResult({
            ok: true,
            code: "SEARCH_TEXT_OK",
            message: "Text search completed.",
            data: buildResultData({
              workingDirectory,
              absoluteRoot,
              query,
              regex,
              caseSensitive,
              fileGlob,
              offset,
              contextLines,
              outputMode,
              searchResult,
              warnings
            })
          }),
          `[search_text] success\n- matches: ${searchResult.matches.length}\n- engine: ${searchResult.engine}${
            warnings.length > 0 ? "\n- warnings emitted" : ""
          }`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "SEARCH_TEXT_FAILED",
            message
          }),
          `[search_text] failed\n- ${message}`
        );
      }
    }
  };
}
