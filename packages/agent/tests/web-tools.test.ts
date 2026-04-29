import { describe, expect, test } from "bun:test";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";

import { createWebFetchTool, createWebSearchTool } from "../src/tools/index.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

function createExecutionContext(): ToolExecutionContext {
  return {
    sessionId: "session-1",
    userId: "user-1",
    workingDirectory: process.cwd(),
    routineRepository: undefined as never,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-04-29",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    permissionRules: {
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionMessages: []
  };
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP server address");
    }

    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

describe("web_search", () => {
  test("normalizes SearXNG JSON results and truncates maxResults", async () => {
    await withServer(
      (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        expect(url.pathname).toBe("/search");
        expect(url.searchParams.get("q")).toBe("agent runtime");
        expect(url.searchParams.get("format")).toBe("json");

        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            results: [
              {
                title: "Runtime A",
                url: "https://example.com/a",
                content: "First result",
                engine: "duckduckgo",
                category: "general"
              },
              {
                title: "Runtime B",
                url: "https://example.org/b",
                content: "Second result"
              }
            ]
          })
        );
      },
      async (baseUrl) => {
        const result = await createWebSearchTool({
          env: { SEARXNG_BASE_URL: baseUrl } as NodeJS.ProcessEnv
        }).execute(
          { query: "agent runtime", maxResults: 1 },
          createExecutionContext()
        );

        expect(result.state).toBe("success");
        expect(result.result.code).toBe("WEB_SEARCH_OK");
        expect(result.displayText).toContain("Runtime A");
        expect(result.content).toContain('"resultCount": 1');
        expect(result.content).toContain('"domain": "example.com"');
        expect(result.content).not.toContain("Runtime B");
      }
    );
  });

  test("fails when SearXNG is not configured", async () => {
    const result = await createWebSearchTool({
      env: {} as NodeJS.ProcessEnv
    }).execute({ query: "agent runtime" }, createExecutionContext());

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("WEB_SEARCH_NOT_CONFIGURED");
  });

  test("returns a failed result for non-2xx SearXNG responses", async () => {
    await withServer(
      (_request, response) => {
        response.statusCode = 503;
        response.end("unavailable");
      },
      async (baseUrl) => {
        const result = await createWebSearchTool({
          env: { SEARXNG_BASE_URL: baseUrl } as NodeJS.ProcessEnv
        }).execute({ query: "agent runtime" }, createExecutionContext());

        expect(result.state).toBe("failed");
        expect(result.result.code).toBe("WEB_SEARCH_FAILED");
        expect(result.error).toContain("503");
      }
    );
  });
});

describe("web_fetch", () => {
  test("extracts readable markdown from an HTML page", async () => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(`<!doctype html>
        <html>
          <head><title>Readable Page</title></head>
          <body>
            <article>
              <h1>Readable Page</h1>
              <p>This is the main article content for extraction.</p>
            </article>
          </body>
        </html>`);
      },
      async (baseUrl) => {
        const result = await createWebFetchTool().execute(
          { url: `${baseUrl}/page`, format: "markdown" },
          createExecutionContext()
        );

        expect(result.state).toBe("success");
        expect(result.result.code).toBe("WEB_FETCH_OK");
        expect(result.content).toContain('"provider": "static_fetch"');
        expect(result.content).toContain('"title": "Readable Page"');
        expect(result.content).toContain("main article content");
        expect(result.content).toContain('"format": "markdown"');
      }
    );
  });

  test("falls back to document text when Readability cannot extract an article", async () => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end("Fallback plain text body");
      },
      async (baseUrl) => {
        const result = await createWebFetchTool().execute(
          { url: `${baseUrl}/plain`, format: "text" },
          createExecutionContext()
        );

        expect(result.state).toBe("success");
        expect(result.content).toContain("Fallback plain text body");
        expect(result.content).toContain('"extraction": "fallback"');
      }
    );
  });

  test("falls back to browser rendering when the static page shell is too thin", async () => {
    let renderCalled = false;

    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(`<!doctype html>
        <html>
          <head><title>Hydrated App</title></head>
          <body>
            <div id="__next"></div>
            <script>window.__NEXT_DATA__ = {};</script>
          </body>
        </html>`);
      },
      async (baseUrl) => {
        const result = await createWebFetchTool({
          renderImpl: async ({ url }: { url: string; timeoutMs: number }) => {
            renderCalled = true;
            return {
              html: `<!doctype html>
              <html>
                <head><title>Hydrated App</title></head>
                <body>
                  <article>
                    <h1>Hydrated App</h1>
                    <p>Rendered content from JavaScript.</p>
                  </article>
                </body>
              </html>`,
              finalUrl: `${url}#rendered`,
              title: "Hydrated App"
            };
          }
        }).execute(
          { url: `${baseUrl}/app`, format: "markdown" },
          createExecutionContext()
        );

        expect(renderCalled).toBe(true);
        expect(result.state).toBe("success");
        expect(result.content).toContain('"provider": "browser_fetch"');
        expect(result.content).toContain("Rendered content from JavaScript.");
      }
    );
  });

  test("returns failed results for unsupported content, non-2xx, and invalid URLs", async () => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
      },
      async (baseUrl) => {
        const result = await createWebFetchTool().execute(
          { url: `${baseUrl}/json` },
          createExecutionContext()
        );
        expect(result.state).toBe("failed");
        expect(result.error).toContain("Unsupported content type");
      }
    );

    await withServer(
      (_request, response) => {
        response.statusCode = 404;
        response.end("not found");
      },
      async (baseUrl) => {
        const result = await createWebFetchTool().execute(
          { url: `${baseUrl}/missing` },
          createExecutionContext()
        );
        expect(result.state).toBe("failed");
        expect(result.error).toContain("404");
      }
    );

    const invalidResult = await createWebFetchTool().execute(
      { url: "file:///tmp/page.html" },
      createExecutionContext()
    );
    expect(invalidResult.state).toBe("failed");
    expect(invalidResult.result.code).toBe("INVALID_TOOL_INPUT");
  });

  test("honors maxChars and timeoutMs", async () => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end(
          `<html><body><main>${"long text ".repeat(100)}</main></body></html>`
        );
      },
      async (baseUrl) => {
        const result = await createWebFetchTool().execute(
          { url: `${baseUrl}/long`, format: "text", maxChars: 20 },
          createExecutionContext()
        );
        expect(result.state).toBe("success");
        expect(result.content).toContain('"truncated": true');
      }
    );

    await withServer(
      (_request, _response) => {
        // Leave the response open so the tool timeout path is exercised.
      },
      async (baseUrl) => {
        const result = await createWebFetchTool().execute(
          { url: `${baseUrl}/slow`, timeoutMs: 10 },
          createExecutionContext()
        );
        expect(result.state).toBe("failed");
        expect(result.error).toContain("timed out");
      }
    );
  });
});
