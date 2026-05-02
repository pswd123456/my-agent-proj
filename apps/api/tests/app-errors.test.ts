import { describe, expect, test } from "bun:test";

import {
  FileSystemLogManager,
  createLogger
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createApiApp } from "../src/app.js";

describe("createApiApp error responses", () => {
  test("returns structured error details for unexpected failures", async () => {
    const app = createApiApp({
      sessionManager: {
        async listSessions() {
          const error = Object.assign(new Error("column todo_state does not exist"), {
            code: "42703",
            hint: "Run the latest database migration.",
            query: 'select "todo_state" from "agent_sessions"'
          });
          throw error;
        }
      } as never,
      routineRepository: createMemoryRoutineRepository(),
      settingsRepository: createMemorySettingsRepository(),
      traceManager: {
        async appendEvent() {},
        async readEvents() {
          return [];
        },
        async deleteEvents() {},
        async truncateEventsAfterTurn() {}
      },
      systemLogManager: new FileSystemLogManager("/tmp/my-agent-proj-api-error-test"),
      apiLogger: createLogger({
        manager: new FileSystemLogManager("/tmp/my-agent-proj-api-error-test"),
        component: "api"
      }),
      buildWorkingDirectory(input) {
        return input ?? process.cwd();
      }
    });

    const response = await app.request("/sessions", {
      headers: {
        "x-request-id": "req-error"
      }
    });

    expect(response.status).toBe(500);
    const payload = (await response.json()) as {
      error: {
        message: string;
        code?: string;
        requestId: string;
        details?: {
          hint?: string;
          query?: string;
          stack?: string;
        };
      };
    };

    expect(payload.error.message).toBe("column todo_state does not exist");
    expect(payload.error.code).toBe("42703");
    expect(payload.error.requestId).toBe("req-error");
    expect(payload.error.details?.hint).toBe(
      "Run the latest database migration."
    );
    expect(payload.error.details?.query).toContain("todo_state");
    expect(payload.error.details?.stack).toContain(
      "column todo_state does not exist"
    );
  });

  test("reuses the same generated request id for logs and error responses", async () => {
    let capturedRequestId: string | null = null;
    const app = createApiApp({
      sessionManager: {
        async listSessions() {
          throw new Error("boom");
        }
      } as never,
      routineRepository: createMemoryRoutineRepository(),
      settingsRepository: createMemorySettingsRepository(),
      traceManager: {
        async appendEvent() {},
        async readEvents() {
          return [];
        },
        async deleteEvents() {},
        async truncateEventsAfterTurn() {}
      },
      systemLogManager: new FileSystemLogManager("/tmp/my-agent-proj-api-error-test"),
      apiLogger: {
        child(bindings) {
          capturedRequestId =
            typeof bindings.requestId === "string" ? bindings.requestId : null;
          return {
            async debug() {},
            async info() {},
            async warn() {},
            async error() {}
          };
        }
      } as ReturnType<typeof createLogger>,
      buildWorkingDirectory(input) {
        return input ?? process.cwd();
      }
    });

    const response = await app.request("/sessions");
    const payload = (await response.json()) as {
      error: {
        requestId: string;
      };
    };

    expect(response.status).toBe(500);
    expect(payload.error.requestId).toBeTruthy();
    expect(response.headers.get("x-request-id")).toBe(payload.error.requestId);
    expect(capturedRequestId).toBe(payload.error.requestId);
  });
});
