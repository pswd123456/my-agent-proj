export interface BrowserRenderInput {
  url: string;
  timeoutMs: number;
  abortSignal?: AbortSignal | undefined;
}

export interface BrowserRenderResult {
  html: string;
  finalUrl: string;
  title: string;
}

export async function renderWebPageWithBrowser(
  input: BrowserRenderInput
): Promise<BrowserRenderResult> {
  if (input.abortSignal?.aborted) {
    throw new Error("Web fetch was interrupted.");
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(input.timeoutMs);
    page.setDefaultNavigationTimeout(input.timeoutMs);

    await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: input.timeoutMs
    });
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(input.timeoutMs, 2500)
      })
      .catch(() => undefined);
    await page.waitForTimeout(500).catch(() => undefined);

    return {
      html: await page.content(),
      finalUrl: page.url(),
      title: await page.title().catch(() => input.url)
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
