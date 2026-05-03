import { promises as fs } from "node:fs";
import path from "node:path";

import type { JsonValue } from "../types.js";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  walkFiles
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS_LIMIT = 500;
const MAX_SCAN_FILES = 5_000;

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMaxResults(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_MAX_RESULTS;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.min(Math.floor(value), MAX_RESULTS_LIMIT);
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

function matchesFilters(input: {
  relativePath: string;
  glob: string | null;
  suffix: string | null;
  namePattern: string | null;
}): boolean {
  const fileName = path.basename(input.relativePath);
  if (input.glob && !globToRegExp(input.glob).test(input.relativePath)) {
    return false;
  }
  if (input.suffix && !fileName.endsWith(input.suffix)) {
    return false;
  }
  if (input.namePattern && !fileName.includes(input.namePattern)) {
    return false;
  }

  return true;
}

export function createFindFilesTool(workingDirectory: string): RuntimeTool {
  return {
    name: "find_files",
    description: buildToolDescription({
      usageScenarios: [
        "Discover candidate files by path filters when you do not know the exact file yet.",
        "Narrow a repo area before reading or editing files.",
        "List matching files without reading their contents."
      ],
      usageInstructions: [
        "Step 1: optionally set path to a directory or file root inside the workspace.",
        describeObjectProperty({
          name: "glob",
          type: "string",
          description:
            "Match workspace-relative paths, for example **/*.ts."
        }),
        describeObjectProperty({
          name: "suffix",
          type: "string",
          description: "Filter by file suffix, for example .test.ts."
        }),
        describeObjectProperty({
          name: "namePattern",
          type: "string",
          description: "Filter by substring in the file name."
        }),
        describeObjectProperty({
          name: "maxResults",
          type: "number",
          description: "Cap the number of returned matches."
        })
      ],
      constraints: [
        "find_files only matches paths; it does not inspect file contents.",
        "Use search_text instead when you know the text but not the file.",
        "Returned paths are workspace-relative and should be fed into read_file or other file tools."
      ],
      examples: [
        '{"path":"packages/agent/src","glob":"**/*.ts","namePattern":"prompt"}',
        '{"suffix":".test.ts","maxResults":20}',
        '{"path":"apps/web","glob":"**/*.tsx","namePattern":"conversation"}'
      ]
    }),
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional directory or file path relative to the workspace root."
        },
        glob: {
          type: "string",
          description:
            "Optional glob pattern matched against workspace-relative paths, for example '**/*.ts'."
        },
        suffix: {
          type: "string",
          description: "Optional file suffix filter, for example '.test.ts'."
        },
        namePattern: {
          type: "string",
          description: "Optional substring matched against file names."
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of matches to return."
        }
      },
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [
        typeof input.path === "string" && input.path.trim().length > 0
          ? input.path.trim()
          : "."
      ];
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (
        input.path !== undefined &&
        normalizeOptionalString(input.path) === null
      ) {
        issues.push({
          field: "path",
          issue: "path must be a non-empty string when provided."
        });
      }
      if (
        input.glob !== undefined &&
        normalizeOptionalString(input.glob) === null
      ) {
        issues.push({
          field: "glob",
          issue: "glob must be a non-empty string when provided."
        });
      }
      if (
        input.suffix !== undefined &&
        normalizeOptionalString(input.suffix) === null
      ) {
        issues.push({
          field: "suffix",
          issue: "suffix must be a non-empty string when provided."
        });
      }
      if (
        input.namePattern !== undefined &&
        normalizeOptionalString(input.namePattern) === null
      ) {
        issues.push({
          field: "namePattern",
          issue: "namePattern must be a non-empty string when provided."
        });
      }
      if (normalizeMaxResults(input.maxResults) === null) {
        issues.push({
          field: "maxResults",
          issue: "maxResults must be a positive number."
        });
      }

      if (issues.length > 0) {
        return {
          ok: false,
          issues
        };
      }

      return {
        ok: true,
        value: input
      };
    },
    async execute(input, context) {
      const rawPath = normalizeOptionalString(input.path) ?? ".";
      const glob = normalizeOptionalString(input.glob);
      const suffix = normalizeOptionalString(input.suffix);
      const namePattern = normalizeOptionalString(input.namePattern);
      const maxResults = normalizeMaxResults(input.maxResults) ?? DEFAULT_MAX_RESULTS;

      try {
        const absoluteRoot = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
        const stat = await fs.stat(absoluteRoot);
        const scannedFiles = stat.isFile()
          ? [absoluteRoot]
          : await walkFiles(absoluteRoot, MAX_SCAN_FILES);

        const matches = scannedFiles
          .map((filePath) => toRelativeWorkspacePath(workingDirectory, filePath))
          .filter((relativePath) =>
            matchesFilters({
              relativePath,
              glob,
              suffix,
              namePattern
            })
          );
        const limitedMatches = matches.slice(0, maxResults);

        return successResult(
          createToolResult({
            ok: true,
            code: "FIND_FILES_OK",
            message: "Workspace files matched successfully.",
            data: {
              root: toRelativeWorkspacePath(workingDirectory, absoluteRoot),
              glob,
              suffix,
              namePattern,
              maxResults,
              matchCount: limitedMatches.length,
              truncated: matches.length > maxResults,
              matches: limitedMatches.map(
                (relativePath): Record<string, JsonValue> => ({
                  path: relativePath,
                  name: path.basename(relativePath)
                })
              )
            }
          }),
          `[find_files] success\n- ${limitedMatches.length} match(es)`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "FIND_FILES_FAILED",
            message
          }),
          `[find_files] failed\n- ${message}`
        );
      }
    }
  };
}
