import { describe, expect, test } from "bun:test";

import { ApiClient } from "../src/client.js";

describe("ApiClient error handling", () => {
  test("surfaces structured api errors with debug details", async () => {
    const client = new ApiClient({
      baseUrl: "http://localhost:3001",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'column "todo_state" does not exist',
              code: "42703",
              requestId: "req-debug",
              details: {
                hint: "Run the latest database migration.",
                query: 'select "todo_state" from "agent_sessions"'
              }
            }
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json"
            }
          }
        )
    });

    await expect(client.listSessions()).rejects.toThrow(
      /column "todo_state" does not exist/
    );
    await expect(client.listSessions()).rejects.toThrow(/code: 42703/);
    await expect(client.listSessions()).rejects.toThrow(/requestId: req-debug/);
    await expect(client.listSessions()).rejects.toThrow(
      /Run the latest database migration/
    );
  });
});
