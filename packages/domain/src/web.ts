import type { DomainJsonValue } from "./json.js";

export interface WebSearchResultItem {
  readonly [key: string]: DomainJsonValue;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  engine?: string;
  category?: string;
  publishedAt?: string;
}

export interface WebSearchResult {
  readonly [key: string]: DomainJsonValue;
  provider: "searxng";
  query: string;
  results: WebSearchResultItem[];
  resultCount: number;
}

export interface WebFetchResult {
  readonly [key: string]: DomainJsonValue;
  provider: "static_fetch" | "browser_fetch" | "hybrid_fetch";
  url: string;
  finalUrl: string;
  title: string;
  content: string;
  format: "markdown" | "text";
  excerpt?: string;
  byline?: string;
  siteName?: string;
  language?: string;
  publishedAt?: string;
  statusCode: number;
  contentType: string;
  extraction: "readability" | "fallback";
  truncated: boolean;
}
