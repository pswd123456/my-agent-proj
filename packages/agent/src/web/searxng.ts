import type {
  WebSearchResult,
  WebSearchResultItem
} from "@ai-app-template/domain";

import {
  clampInteger,
  createTimeoutSignal,
  DEFAULT_NETWORK_TIMEOUT_MS,
  MAX_NETWORK_TIMEOUT_MS
} from "./shared.js";

export interface SearxngSearchInput {
  query: string;
  maxResults?: number | undefined;
  language?: string | undefined;
  timeRange?: "day" | "month" | "year" | undefined;
  timeoutMs?: number | undefined;
}

export interface SearxngSearchOptions {
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  abortSignal?: AbortSignal | undefined;
}

interface SearxngResultRecord {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  engine?: unknown;
  category?: unknown;
  publishedDate?: unknown;
  publishedAt?: unknown;
}

interface SearxngSearchResponse {
  results?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseSearchResponse(value: unknown): SearxngSearchResponse {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...(Array.isArray(value.results) ? { results: value.results } : {})
  };
}

function normalizeResult(value: unknown): WebSearchResultItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value as SearxngResultRecord;
  const title = toOptionalString(record.title);
  const url = toOptionalString(record.url);
  if (!title || !url) {
    return null;
  }

  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }

  const snippet = toOptionalString(record.content) ?? "";
  const engine = toOptionalString(record.engine);
  const category = toOptionalString(record.category);
  const publishedAt =
    toOptionalString(record.publishedAt) ??
    toOptionalString(record.publishedDate);

  return {
    title,
    url,
    snippet,
    domain,
    ...(engine ? { engine } : {}),
    ...(category ? { category } : {}),
    ...(publishedAt ? { publishedAt } : {})
  };
}

function buildSearchUrl(input: {
  baseUrl: string;
  searchInput: SearxngSearchInput;
}): URL {
  const url = new URL("/search", input.baseUrl);
  url.searchParams.set("q", input.searchInput.query);
  url.searchParams.set("format", "json");

  if (input.searchInput.language?.trim()) {
    url.searchParams.set("language", input.searchInput.language.trim());
  }
  if (input.searchInput.timeRange) {
    url.searchParams.set("time_range", input.searchInput.timeRange);
  }

  return url;
}

export async function searchSearxng(
  input: SearxngSearchInput,
  options: SearxngSearchOptions
): Promise<WebSearchResult> {
  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error("SEARXNG_BASE_URL is not configured.");
  }

  const maxResults = clampInteger({
    value: input.maxResults,
    defaultValue: 5,
    min: 1,
    max: 10
  });
  const timeoutMs = clampInteger({
    value: input.timeoutMs,
    defaultValue: DEFAULT_NETWORK_TIMEOUT_MS,
    min: 1,
    max: MAX_NETWORK_TIMEOUT_MS
  });
  const searchUrl = buildSearchUrl({ baseUrl, searchInput: input });
  const timeout = createTimeoutSignal({
    timeoutMs,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {})
  });

  try {
    const response = await (options.fetchImpl ?? fetch)(searchUrl, {
      headers: { Accept: "application/json" },
      signal: timeout.signal
    });
    if (!response.ok) {
      throw new Error(`SearXNG returned status ${response.status}.`);
    }

    const payload = parseSearchResponse(await response.json());
    const results = Array.isArray(payload.results)
      ? payload.results.map(normalizeResult).filter((result) => result !== null)
      : [];
    const limitedResults = results.slice(0, maxResults);

    return {
      provider: "searxng",
      query: input.query,
      results: limitedResults,
      resultCount: limitedResults.length
    };
  } catch (error) {
    if (timeout.signal.aborted && timeout.isTimedOut()) {
      throw new Error(`SearXNG request timed out after ${timeoutMs}ms.`);
    }
    if (timeout.signal.aborted) {
      throw new Error("SearXNG request was interrupted.");
    }

    throw error;
  } finally {
    timeout.cleanup();
  }
}
