import path from "node:path";

import { toRelativeWorkspacePath, walkFiles } from "./tools/workspace.js";

const DEFAULT_MAX_RESULTS = 8;
const MAX_RESULTS_LIMIT = 50;
const MAX_SCAN_FILES = 5_000;

export interface WorkspaceFileSearchMatch {
  path: string;
  name: string;
  score: number;
}

export interface SearchWorkspaceFilesInput {
  workingDirectory: string;
  query?: string | null | undefined;
  maxResults?: number | null | undefined;
}

export interface SearchWorkspaceFilesResult {
  matches: WorkspaceFileSearchMatch[];
  matchCount: number;
  truncated: boolean;
}

export function normalizeWorkspaceFileSearchLimit(
  value: number | null | undefined
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(Math.floor(value), MAX_RESULTS_LIMIT);
}

function scoreWorkspaceFileMatch(relativePath: string, query: string): number {
  const normalizedQuery = query.toLowerCase();
  const fileName = path.basename(relativePath).toLowerCase();
  const normalizedPath = relativePath.toLowerCase();

  if (fileName === normalizedQuery) {
    return 400;
  }
  if (normalizedPath === normalizedQuery) {
    return 360;
  }
  if (fileName.startsWith(normalizedQuery)) {
    return 300;
  }
  if (fileName.includes(normalizedQuery)) {
    return 220;
  }
  if (normalizedPath.includes(normalizedQuery)) {
    return 120;
  }

  return 0;
}

export async function searchWorkspaceFiles(
  input: SearchWorkspaceFilesInput
): Promise<SearchWorkspaceFilesResult> {
  const query = input.query?.trim() ?? "";
  if (query.length === 0) {
    return {
      matches: [],
      matchCount: 0,
      truncated: false
    };
  }

  const maxResults = normalizeWorkspaceFileSearchLimit(input.maxResults);
  const scannedFiles = await walkFiles(
    path.resolve(input.workingDirectory),
    MAX_SCAN_FILES
  );
  const matches = scannedFiles
    .map((filePath) =>
      toRelativeWorkspacePath(input.workingDirectory, filePath)
    )
    .map((relativePath) => ({
      path: relativePath,
      name: path.basename(relativePath),
      score: scoreWorkspaceFileMatch(relativePath, query)
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.path.length - right.path.length ||
        left.path.localeCompare(right.path)
    );

  return {
    matches: matches.slice(0, maxResults),
    matchCount: matches.length,
    truncated:
      matches.length > maxResults || scannedFiles.length >= MAX_SCAN_FILES
  };
}
