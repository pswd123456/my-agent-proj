import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";

import { createMakeHttpRequestTool } from "../src/tools/make-http-request.js";

describe("make_http_request", () => {
  test("returns a failed tool result for non-2xx responses", async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 404;
      response.end("not found");
    });

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

      const tool = createMakeHttpRequestTool();
      const result = await tool.execute(
        {
          url: `http://127.0.0.1:${address.port}/missing`
        },
        {
          sessionId: "session-1",
          userId: "user-1",
          workingDirectory: process.cwd(),
          routineRepository: undefined as never,
          sessionManager: undefined as never,
          sessionContext: {
            status: "running",
            currentDateContext: "2026-04-23"
          }
        }
      );

      expect(result.state).toBe("failed");
      expect(result.error).toContain("404");
      expect(result.content).toContain("\"ok\": false");
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
  });
});
