import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  walkFiles
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 200;
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
};

type SearchResult = {
  matches: SearchMatch[];
  engine: "rg" | "node";
  truncated: boolean;
};

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

function runRipgrep(input: {
  workingDirectory: string;
  absoluteRoot: string;
  query: string;
  regex: boolean;
  maxResults: number;
  abortSignal?: AbortSignal;
}): Promise<SearchResult | null> {
  return new Promise((resolve, reject) => {
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
      String(input.maxResults),
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
      input.query,
      input.absoluteRoot
    ];
    if (!input.regex) {
      args.unshift("--fixed-strings");
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

      const matches: SearchMatch[] = [];
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

        matches.push({
          path: toRelativeWorkspacePath(
            input.workingDirectory,
            line.slice(0, firstSeparator)
          ),
          line: lineNumber,
          snippet: line.slice(secondSeparator + 1).trim()
        });

        if (matches.length >= input.maxResults) {
          break;
        }
      }

      if (stderr && code !== 1 && matches.length === 0) {
        finish(null);
        return;
      }

      finish({
        matches,
        engine: "rg",
        truncated: matches.length >= input.maxResults
      });
    });
  });
}

async function searchWithNode(input: {
  workingDirectory: string;
  absoluteRoot: string;
  query: string;
  regex: boolean;
  maxResults: number;
}): Promise<SearchResult> {
  const rootStat = await fs.stat(input.absoluteRoot);
  const files = rootStat.isFile()
    ? [input.absoluteRoot]
    : await walkFiles(input.absoluteRoot, 2_000);
  const matches: SearchMatch[] = [];
  const pattern = input.regex ? new RegExp(input.query) : null;

  for (const filePath of files) {
    if (matches.length >= input.maxResults) {
      break;
    }
    if (shouldIgnorePath(filePath)) {
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
      if (pattern ? !pattern.test(line) : !line.includes(input.query)) {
        continue;
      }

      matches.push({
        path: toRelativeWorkspacePath(input.workingDirectory, filePath),
        line: index + 1,
        snippet: line.trim()
      });

      if (matches.length >= input.maxResults) {
        break;
      }
    }
  }

  return {
    matches,
    engine: "node",
    truncated: matches.length >= input.maxResults
  };
}

export function createSearchTextTool(workingDirectory: string): RuntimeTool {
  return {
    name: "search_text",
    description: "Search for a text fragment across workspace files.",
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
          description: "Text fragment to look for."
        },
        path: {
          type: "string",
          description: "Optional search root relative to the workspace root."
        },
        regex: {
          type: "boolean",
          description: "Treat query as a regular expression instead of a literal string."
        },
        maxResults: {
          type: "number",
          description: "Optional result limit."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [typeof input.path === "string" && input.path.length > 0 ? input.path : "."];
    },
    validate(input) {
      const query = input.query;
      if (typeof query === "string" && query.trim()) {
        return { ok: true, value: input };
      }

      return {
        ok: false,
        issues: [
          {
            field: "query",
            issue: "query is required."
          }
        ]
      };
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
      const maxResults = normalizeMaxResults(input.maxResults);

      try {
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
            maxResults,
            ...(context.abortSignal ? { abortSignal: context.abortSignal } : {})
          };
        const searchResult =
          (await runRipgrep(ripgrepInput)) ??
          (await searchWithNode({
            workingDirectory,
            absoluteRoot,
            query,
            regex,
            maxResults
          }));

        const result = {
          root: toRelativeWorkspacePath(workingDirectory, absoluteRoot),
          query,
          regex,
          engine: searchResult.engine,
          truncated: searchResult.truncated,
          matches: searchResult.matches
        };
        return successResult(
          createToolResult({
            ok: true,
            code: "SEARCH_TEXT_OK",
            message: "Text search completed.",
            data: result
          }),
          `[search_text] success\n- matches: ${searchResult.matches.length}\n- engine: ${searchResult.engine}`
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
