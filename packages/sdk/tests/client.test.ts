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

  test("yields between streamed assistant text events from the same chunk", async () => {
    const encoder = new TextEncoder();
    const assistantEvent = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-27T10:00:00.000Z",
      turnCount: 1,
      assistantMessageId: "assistant-1",
      text: "Hel",
      snapshot: "Hel"
    };
    const assistantEvent2 = {
      ...assistantEvent,
      createdAt: "2026-04-27T10:00:00.050Z",
      text: "Hello",
      snapshot: "Hello"
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              "event: trace",
              `data: ${JSON.stringify(assistantEvent)}`,
              "",
              "event: trace",
              `data: ${JSON.stringify(assistantEvent2)}`,
              "",
              ""
            ].join("\n")
          )
        );
        controller.close();
      }
    });

    const client = new ApiClient({
      baseUrl: "http://localhost:3001",
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8"
          }
        })
    });

    const order: string[] = [];
    await client.streamSessionExecution({
      sessionId: "session-1",
      message: "hello",
      onEvent(event) {
        order.push(event.text);
        if (event.text === "Hel") {
          setTimeout(() => {
            order.push("timer");
          }, 0);
        }
      }
    });

    expect(order).toEqual(["Hel", "timer", "Hello"]);
  });

  test("clears session history with the dedicated endpoint", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const client = new ApiClient({
      baseUrl: "http://localhost:3001",
      fetch: async (url, init) => {
        calls.push({ url: String(url), method: init?.method });
        return new Response(null, { status: 204 });
      }
    });

    await client.clearSessionHistory();

    expect(calls).toEqual([
      {
        url: "http://localhost:3001/sessions/history",
        method: "DELETE"
      }
    ]);
  });
});
