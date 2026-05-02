import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";

import {
  createMemoryBackgroundTaskRepository,
  createMemoryRoutineRepository
} from "@ai-app-template/db";

import {
  createAgentRuntime,
  createBackgroundTaskManager,
  createDelegateAgentService,
  createDelegateAgentTool,
  type RunStreamEvent
} from "../src/index.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { RuntimeTool } from "../src/tools/runtime-tool.js";

function createInjectedNotificationTool(): RuntimeTool {
  return {
    name: "inject_background_notification",
    description: "Injects a background notification for runtime tests.",
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    validate() {
      return { ok: true, value: {} };
    },
    async execute(_input, context) {
      const session = await context.sessionManager.getSession(context.sessionId);
      if (!session) {
        throw new Error(`Unknown session: ${context.sessionId}`);
      }

      await context.sessionManager.updateContext(context.sessionId, {
        pendingBackgroundNotifications: [
          ...session.context.pendingBackgroundNotifications,
          {
            id: "notification-1",
            kind: "task_completed",
            taskId: "delegate-1",
            title: "后台子任务",
            summary: "后台子任务已完成。",
            content: "后台子任务已完成。",
            createdAt: "2026-04-27T00:00:00.000Z",
            requiresMainAgentReply: false,
            expectedParentReply: "none"
          }
        ]
      });

      return {
        state: "success",
        content: JSON.stringify(
          {
            ok: true,
            code: "NOTIFICATION_INJECTED",
            message: "Injected background notification."
          },
          null,
          2
        ),
        displayText: "[inject_background_notification] success",
        result: {
          ok: true,
          code: "NOTIFICATION_INJECTED",
          message: "Injected background notification."
        }
      };
    }
  };
}

function createNoopTool(): RuntimeTool {
  return {
    name: "noop_tool",
    description: "Returns a successful no-op result for runtime tests.",
    family: "planning",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    validate() {
      return { ok: true, value: {} };
    },
    async execute() {
      return {
        state: "success",
        content: JSON.stringify(
          {
            ok: true,
            code: "NOOP_OK",
            message: "No-op completed."
          },
          null,
          2
        ),
        displayText: "[noop_tool] success",
        result: {
          ok: true,
          code: "NOOP_OK",
          message: "No-op completed."
        }
      };
    }
  };
}

describe("delegate runtime behavior", () => {
  test("suspends the parent run after delegate_agent reports an active background task", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const backgroundTaskRepository = createMemoryBackgroundTaskRepository();
    const backgroundTaskManager = createBackgroundTaskManager({
      sessionManager,
      repository: backgroundTaskRepository
    });
    const delegateAgentService = createDelegateAgentService({
      sessionManager,
      taskManager: backgroundTaskManager
    });
    let requestCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            requestCount += 1;
            if (requestCount > 1) {
              throw new Error(
                "runtime should suspend instead of polling the delegate again"
              );
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: "我先创建一个子代理。"
                },
                {
                  type: "tool_use" as const,
                  id: "delegate-start",
                  name: "delegate_agent",
                  input: {
                    action: "start",
                    title: "测试子代理任务",
                    objective: "确认后台 delegation 是否按预期挂起主代理。",
                    parent_task_summary: "用户要求测试子代理调用。",
                    message: "请在后台完成一个简单检查。"
                  }
                }
              ],
              stop_reason: "tool_use",
              usage: {
                input_tokens: 18,
                output_tokens: 12,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      delegateAgentService,
      toolRegistry: new ToolRegistry().register(createDelegateAgentTool())
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/runtime-delegate",
      userId: "delegate-runtime-user"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "测试一下子代理"
    });

    expect(requestCount).toBe(1);
    expect(result.status).toBe("waiting for input");
    expect(result.stopReason).toBe("background_task_running");
    expect(result.finalAnswer).toBe("");
    expect(result.session.context.status).toBe("waiting_for_user_input");
    expect(result.session.context.activeBackgroundTaskCount).toBe(1);
    expect(result.session.context.pendingBackgroundNotifications).toHaveLength(0);
    expect(result.toolOutputs).toHaveLength(1);
    expect(result.toolOutputs[0]?.content).toContain('"status": "queued"');
  });

  test("lets unblocking delegates continue through other work before suspending", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const backgroundTaskRepository = createMemoryBackgroundTaskRepository();
    const backgroundTaskManager = createBackgroundTaskManager({
      sessionManager,
      repository: backgroundTaskRepository
    });
    const delegateAgentService = createDelegateAgentService({
      sessionManager,
      taskManager: backgroundTaskManager
    });
    let requestCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            requestCount += 1;
            if (requestCount === 1) {
              return {
                content: [
                  {
                    type: "tool_use" as const,
                    id: "delegate-start-unblocking",
                    name: "delegate_agent",
                    input: {
                      action: "start",
                      title: "测试非阻塞子代理",
                      objective: "确认主代理可以继续执行其他工具。",
                      parent_task_summary: "用户要求测试 unblocking delegation。",
                      message: "请在后台完成一个简单检查。",
                      wait_mode: "unblocking",
                      initial_check_after_ms: 1500
                    }
                  },
                  {
                    type: "tool_use" as const,
                    id: "noop-after-delegate",
                    name: "noop_tool",
                    input: {}
                  }
                ],
                stop_reason: "tool_use",
                usage: {
                  input_tokens: 18,
                  output_tokens: 12,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              };
            }

            if (requestCount === 2) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "其他可做事项已经处理，等待后台结果。"
                  }
                ],
                stop_reason: "end_turn",
                usage: {
                  input_tokens: 18,
                  output_tokens: 8,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              };
            }

            throw new Error("unexpected extra runtime turn");
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      delegateAgentService,
      backgroundTaskManager,
      toolRegistry: new ToolRegistry()
        .register(createDelegateAgentTool())
        .register(createNoopTool())
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/runtime-delegate-unblocking",
      userId: "delegate-runtime-user"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "测试一下非阻塞子代理"
    });

    expect(requestCount).toBe(2);
    expect(result.status).toBe("waiting for input");
    expect(result.stopReason).toBe("background_task_running");
    expect(result.toolOutputs.map((output) => output.toolName)).toEqual([
      "delegate_agent",
      "noop_tool"
    ]);

    const wakeupTask = await backgroundTaskRepository.getWakeupTaskBySessionId(
      session.sessionId
    );
    expect(wakeupTask?.kind).toBe("session_wakeup");
    expect(wakeupTask?.status).toBe("queued");
    expect(wakeupTask?.availableAt).not.toBeNull();
    expect(wakeupTask?.payload.metadata).toMatchObject({
      reason: "background_task_poll",
      nextIntervalMs: 1500
    });
  });

  test("consumes background notifications that arrive during the previous turn", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let requestCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            requestCount += 1;
            if (requestCount === 1) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "我先注入一条后台通知。"
                  },
                  {
                    type: "tool_use" as const,
                    id: "inject-notification",
                    name: "inject_background_notification",
                    input: {}
                  }
                ],
                stop_reason: "tool_use",
                usage: {
                  input_tokens: 16,
                  output_tokens: 8,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              };
            }

            if (requestCount === 2) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "我已看到后台结果，并完成这轮处理。"
                  }
                ],
                stop_reason: "end_turn",
                usage: {
                  input_tokens: 20,
                  output_tokens: 10,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              };
            }

            throw new Error("unexpected extra runtime turn");
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry().register(createInjectedNotificationTool())
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/runtime-notification",
      userId: "notification-runtime-user"
    });
    const streamEvents: RunStreamEvent[] = [];

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "测试后台通知消费",
      eventSink(event) {
        streamEvents.push(event);
      }
    });

    expect(requestCount).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("我已看到后台结果，并完成这轮处理。");
    expect(result.session.context.pendingBackgroundNotifications).toHaveLength(0);

    const consumedEvent = streamEvents.find(
      (
        event
      ): event is Extract<
        RunStreamEvent,
        { kind: "background_notification_consumed" }
      > => event.kind === "background_notification_consumed"
    );
    expect(consumedEvent).toBeDefined();
    expect(consumedEvent?.notification.id).toBe("notification-1");
  });

  test("clears externally injected background notifications after a completed turn", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let requestCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            requestCount += 1;
            if (requestCount !== 1) {
              throw new Error("unexpected extra runtime turn");
            }

            const session = await sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Unknown session: ${sessionId}`);
            }

            await sessionManager.updateContext(sessionId, {
              pendingBackgroundNotifications: [
                ...session.context.pendingBackgroundNotifications,
                {
                  id: "mid-turn-notification",
                  kind: "task_completed",
                  taskId: "delegate-mid-turn",
                  title: "后台子任务",
                  summary: "后台子任务在当前回合中完成。",
                  content: "后台子任务在当前回合中完成。",
                  createdAt: "2026-04-27T00:00:00.000Z",
                  requiresMainAgentReply: false,
                  expectedParentReply: "none"
                }
              ]
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: "我已经处理好这轮任务。"
                }
              ],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 14,
                output_tokens: 8,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry()
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/runtime-mid-turn-notification",
      userId: "mid-turn-notification-user"
    });
    const sessionId = session.sessionId;
    const streamEvents: RunStreamEvent[] = [];

    const result = await runtime.run({
      sessionId,
      message: "处理一下当前任务",
      eventSink(event) {
        streamEvents.push(event);
      }
    });

    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("我已经处理好这轮任务。");
    expect(result.session.context.pendingBackgroundNotifications).toHaveLength(0);

    const consumedEvent = streamEvents.find(
      (
        event
      ): event is Extract<
        RunStreamEvent,
        { kind: "background_notification_consumed" }
      > => event.kind === "background_notification_consumed"
    );
    expect(consumedEvent?.notification.id).toBe("mid-turn-notification");
  });
});
