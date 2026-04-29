import { Readability } from "@mozilla/readability";
import type { WebFetchResult } from "@ai-app-template/domain";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

import {
  renderWebPageWithBrowser,
  type BrowserRenderInput,
  type BrowserRenderResult
} from "./browser-render.js";
import {
  clampInteger,
  createTimeoutSignal,
  DEFAULT_NETWORK_TIMEOUT_MS,
  MAX_NETWORK_TIMEOUT_MS,
  toHttpUrl,
  truncateContent
} from "./shared.js";

export interface WebPageFetchInput {
  url: string;
  format?: "markdown" | "text" | undefined;
  maxChars?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface WebPageFetchOptions {
  fetchImpl?: typeof fetch | undefined;
  renderImpl?:
    | ((input: BrowserRenderInput) => Promise<BrowserRenderResult>)
    | undefined;
  abortSignal?: AbortSignal | undefined;
}

interface ExtractedArticle {
  title: string;
  content: string;
  textContent: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function scoreContent(value: string): number {
  return normalizeWhitespace(value).length;
}

function fallbackText(document: Document): string {
  const target = document.querySelector("main") ?? document.body;
  return normalizeWhitespace(target?.textContent ?? "");
}

function fallbackTitle(document: Document, url: string): string {
  const title = normalizeWhitespace(document.title);
  if (title) {
    return title;
  }

  return url;
}

function extractArticle(
  html: string,
  url: string
): {
  article: ExtractedArticle;
  document: Document;
  extraction: "readability" | "fallback";
} {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(
    dom.window.document.cloneNode(true) as Document
  );
  const parsed = reader.parse();

  if (parsed?.textContent?.trim()) {
    const excerpt = toOptionalString(parsed.excerpt);
    const byline = toOptionalString(parsed.byline);
    const siteName = toOptionalString(parsed.siteName);
    const lang = toOptionalString(parsed.lang);
    const publishedTime = toOptionalString(parsed.publishedTime);

    return {
      article: {
        title: parsed.title || fallbackTitle(dom.window.document, url),
        content: parsed.content || parsed.textContent,
        textContent: parsed.textContent,
        ...(excerpt ? { excerpt } : {}),
        ...(byline ? { byline } : {}),
        ...(siteName ? { siteName } : {}),
        ...(lang ? { lang } : {}),
        ...(publishedTime ? { publishedTime } : {})
      },
      document: dom.window.document,
      extraction: "readability"
    };
  }

  const textContent = fallbackText(dom.window.document);
  return {
    article: {
      title: fallbackTitle(dom.window.document, url),
      content: textContent,
      textContent
    },
    document: dom.window.document,
    extraction: "fallback"
  };
}

function extractFallbackOnly(
  html: string,
  url: string
): {
  article: ExtractedArticle;
  document: Document;
} {
  const dom = new JSDOM(html, { url });
  const textContent = fallbackText(dom.window.document);

  return {
    article: {
      title: fallbackTitle(dom.window.document, url),
      content: textContent,
      textContent
    },
    document: dom.window.document
  };
}

function renderContent(input: {
  article: ExtractedArticle;
  format: "markdown" | "text";
}): string {
  if (input.format === "text") {
    return normalizeWhitespace(input.article.textContent);
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced"
  });
  return turndown.turndown(input.article.content).trim();
}

const CLIENT_RENDER_MARKERS = [
  /__NEXT_DATA__/i,
  /__NUXT__/i,
  /data-reactroot/i,
  /data-v-app/i,
  /ng-version/i,
  /window\.__/i,
  /id=["'](?:app|root)["']/i
];

function hasClientRenderMarkers(html: string): boolean {
  return CLIENT_RENDER_MARKERS.some((pattern) => pattern.test(html));
}

function shouldAttemptBrowserRender(input: {
  contentType: string;
  html: string;
  staticContent: string;
  extraction: "readability" | "fallback";
}): boolean {
  const isHtmlContent =
    input.contentType.includes("text/html") ||
    input.contentType.includes("application/xhtml+xml");
  if (!isHtmlContent) {
    return false;
  }

  const staticScore = scoreContent(input.staticContent);
  if (staticScore >= 900) {
    return false;
  }

  if (hasClientRenderMarkers(input.html)) {
    return true;
  }

  return input.extraction === "fallback" && staticScore < 240;
}

function shouldPreferBrowserResult(input: {
  staticContent: string;
  browserContent: string;
}): boolean {
  const staticScore = scoreContent(input.staticContent);
  const browserScore = scoreContent(input.browserContent);

  if (browserScore <= 0) {
    return false;
  }

  if (staticScore < 200) {
    return browserScore > 0;
  }

  return browserScore > staticScore + 120 || browserScore > staticScore * 1.2;
}

function toWebFetchProvider(input: {
  browserAttempted: boolean;
  selectedSource: "static" | "browser";
}): WebFetchResult["provider"] {
  if (!input.browserAttempted) {
    return "static_fetch";
  }

  return input.selectedSource === "browser" ? "browser_fetch" : "hybrid_fetch";
}

export async function fetchWebPage(
  input: WebPageFetchInput,
  options: WebPageFetchOptions = {}
): Promise<WebFetchResult> {
  const url = toHttpUrl(input.url);
  const format = input.format ?? "markdown";
  const maxChars = clampInteger({
    value: input.maxChars,
    defaultValue: 12_000,
    min: 1,
    max: 60_000
  });
  const timeoutMs = clampInteger({
    value: input.timeoutMs,
    defaultValue: DEFAULT_NETWORK_TIMEOUT_MS,
    min: 1,
    max: MAX_NETWORK_TIMEOUT_MS
  });
  const timeout = createTimeoutSignal({
    timeoutMs,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {})
  });
  const startedAt = Date.now();

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5"
      },
      signal: timeout.signal
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      throw new Error(`Web fetch returned status ${response.status}.`);
    }
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(`Unsupported content type: ${contentType}.`);
    }

    const html = await response.text();
    const finalUrl = response.url || url.toString();
    const staticExtracted = contentType.includes("text/plain")
      ? {
          ...extractFallbackOnly(html, finalUrl),
          extraction: "fallback" as const
        }
      : extractArticle(html, finalUrl);
    const staticRendered = renderContent({
      article: staticExtracted.article,
      format
    });
    const browserAttempted = shouldAttemptBrowserRender({
      contentType,
      html,
      staticContent: staticRendered,
      extraction: staticExtracted.extraction
    });

    let selectedSource: "static" | "browser" = "static";
    let selectedExtracted = staticExtracted;
    let selectedRendered = staticRendered;
    let selectedFinalUrl = finalUrl;

    if (browserAttempted) {
      const browserTimeoutMs = Math.max(
        1,
        timeoutMs - Math.max(0, Date.now() - startedAt)
      );
      const browserRender = options.renderImpl ?? renderWebPageWithBrowser;

      try {
        const browserResult = await browserRender({
          url: finalUrl,
          timeoutMs: browserTimeoutMs,
          ...(options.abortSignal ? { abortSignal: options.abortSignal } : {})
        });
        const browserExtracted = extractArticle(browserResult.html, browserResult.finalUrl);
        const browserRendered = renderContent({
          article: browserExtracted.article,
          format
        });

        if (
          shouldPreferBrowserResult({
            staticContent: staticRendered,
            browserContent: browserRendered
          })
        ) {
          selectedSource = "browser";
          selectedExtracted = browserExtracted;
          selectedRendered = browserRendered;
          selectedFinalUrl = browserResult.finalUrl;
        }
      } catch {
        void 0;
      }
    }

    const truncated = truncateContent({
      content: selectedRendered,
      maxChars
    });

    return {
      provider: toWebFetchProvider({
        browserAttempted,
        selectedSource
      }),
      url: url.toString(),
      finalUrl: selectedFinalUrl,
      title: selectedExtracted.article.title,
      content: truncated.content,
      format,
      ...(selectedExtracted.article.excerpt
        ? { excerpt: selectedExtracted.article.excerpt }
        : {}),
      ...(selectedExtracted.article.byline
        ? { byline: selectedExtracted.article.byline }
        : {}),
      ...(selectedExtracted.article.siteName
        ? { siteName: selectedExtracted.article.siteName }
        : {}),
      ...(selectedExtracted.article.lang
        ? { language: selectedExtracted.article.lang }
        : {}),
      ...(selectedExtracted.article.publishedTime
        ? { publishedAt: selectedExtracted.article.publishedTime }
        : {}),
      statusCode: response.status,
      contentType,
      extraction: selectedExtracted.extraction,
      truncated: truncated.truncated
    };
  } catch (error) {
    if (timeout.signal.aborted && timeout.isTimedOut()) {
      throw new Error(`Web fetch timed out after ${timeoutMs}ms.`);
    }
    if (timeout.signal.aborted) {
      throw new Error("Web fetch was interrupted.");
    }

    throw error;
  } finally {
    timeout.cleanup();
  }
}
