import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";

import {
  createMemoryBackgroundTaskRepository,
  createMemoryRoutineRepository
} from "@ai-app-template/db";

import {
  createAgentRuntime,
  createBackgroundTaskManager
} from "../src/index.js";
import type { AnthropicMessageRequest } from "../src/model.js";
import { getUserContextHookConfigHash } from "../src/subagent-hooks.js";
import type { TraceEvent, TraceManager, TraceRecord } from "../src/trace.js";
import { ToolRegistry } from "../src/tools/registry.js";

class MemoryTraceManager implements TraceManager {
  readonly events: TraceEvent[] = [];

  async appendEvent(_sessionId: string, event: TraceEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async readEvents(_sessionId: string): Promise<TraceRecord[]> {
    return [];
  }

  async deleteEvents(_sessionId: string): Promise<void> {
    this.events.length = 0;
  }
}

describe("subagent hook runtime", () => {
  test("session_started blocking hook schedules a hook task and suspends before the first model request", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const backgroundTaskRepository = createMemoryBackgroundTaskRepository();
    const backgroundTaskManager = createBackgroundTaskManager({
      sessionManager,
      repository: backgroundTaskRepository
    });
    let requestCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            requestCount += 1;
            return {
              content: [{ type: "text" as const, text: "不应该走到这里" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      backgroundTaskManager,
      routineRepository: createMemoryRoutineRepository(),
      toolRegistry: new ToolRegistry(),
      userContextHooks: [
        {
          id: "hook-blocking",
          event: "session_started",
          behavior: "subagent",
          waitMode: "blocking",
          maxTurns: 37,
          title: "预运行检查",
          content: "先检查仓库当前实现，再给主会话补充上下文。",
          enabled: true
        }
      ]
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/subagent-hook-blocking",
      userId: "hook-user"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "继续"
    });

    expect(requestCount).toBe(0);
    expect(result.status).toBe("waiting for input");
    expect(result.stopReason).toBe("background_task_running");
    expect(result.finalAnswer).toBe("");
    expect(result.session.context.status).toBe("waiting_for_user_input");
    expect(result.session.context.activeBackgroundTaskCount).toBe(1);

    const tasks = await backgroundTaskManager.listTasksByParentSession(
      session.sessionId
    );
    const hookTask = tasks.find((task) => task.kind === "hook_subagent");
    const wakeupTask = await backgroundTaskRepository.getWakeupTaskBySessionId(
      session.sessionId
    );

    expect(hookTask).toBeDefined();
    expect(hookTask?.payload.message).toBe(
      "先检查仓库当前实现，再给主会话补充上下文。"
    );
    expect(hookTask?.payload.maxTurns).toBe(37);
    expect(hookTask?.payload.metadata).toMatchObject({
      hookId: "hook-blocking",
      hookEvent: "session_started",
      resumeMessage: "继续",
      skipSubagentHooks: true
    });
    expect(hookTask?.taskState?.kind).toBe("hook_subagent");
    expect(hookTask?.childSessionId).not.toBeNull();

    expect(wakeupTask?.kind).toBe("session_wakeup");
    expect(wakeupTask?.payload.message).toBe("继续");
    expect(wakeupTask?.payload.maxTurns).toBe(session.maxTurns);
    expect(wakeupTask?.payload.metadata).toMatchObject({
      reason: "background_task_poll",
      skipSubagentHooks: true
    });
    expect(Array.isArray(wakeupTask?.payload.metadata.backgroundTaskIds)).toBe(
      true
    );
    expect(wakeupTask?.payload.metadata.backgroundTaskIds).toContain(
      hookTask?.taskId
    );
  });

  test("materializes completed hook notifications into runtime context on the next run", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const traceManager = new MemoryTraceManager();
    const requests: AnthropicMessageRequest[] = [];

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create(request) {
            requests.push(structuredClone(request));
            return {
              content: [
                { type: "text" as const, text: "已读取 hook 上下文。" }
              ],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 10,
                output_tokens: 6,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      traceManager,
      routineRepository: createMemoryRoutineRepository(),
      toolRegistry: new ToolRegistry(),
      userContextHooks: [
        {
          id: "hook-unblocking",
          event: "run_started",
          behavior: "subagent",
          waitMode: "unblocking",
          title: "背景资料",
          content: "先整理和当前问题相关的背景资料。",
          enabled: true
        }
      ]
    });
    const hookConfigHash = getUserContextHookConfigHash({
      event: "run_started",
      behavior: "subagent",
      waitMode: "unblocking",
      title: "背景资料",
      content: "先整理和当前问题相关的背景资料。"
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/subagent-hook-injection",
      userId: "hook-user"
    });

    await runtime.recoverSession({
      ...session,
      context: {
        ...session.context,
        pendingBackgroundNotifications: [
          {
            id: "notification-hook-1",
            kind: "task_completed",
            taskId: "task-hook-1",
            taskKind: "hook_subagent",
            title: "背景资料",
            summary: "hook 已完成",
            content: "hook 已完成",
            createdAt: "2026-05-01T00:00:00.000Z",
            requiresMainAgentReply: false,
            expectedParentReply: "none",
            result: {
              type: "hook_subagent",
              hookId: "hook-unblocking",
              hookEvent: "run_started",
              waitMode: "unblocking",
              title: "背景资料",
              configHash: hookConfigHash,
              content: "这是 hook 子代理整理出来的最终背景摘要。"
            }
          }
        ]
      }
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "继续"
    });

    expect(result.status).toBe("completed");
    expect(result.session.context.pendingBackgroundNotifications).toEqual([]);
    expect(result.session.context.hookContextEntries).toHaveLength(1);
    expect(result.session.context.hookContextEntries[0]).toMatchObject({
      hookId: "hook-unblocking",
      hookEvent: "run_started",
      waitMode: "unblocking",
      title: "背景资料",
      content: "这是 hook 子代理整理出来的最终背景摘要。"
    });

    const promptEvent = traceManager.events.find(
      (event): event is Extract<TraceEvent, { kind: "prompt" }> =>
        event.kind === "prompt"
    );
    expect(promptEvent).toBeDefined();
    expect(
      promptEvent?.runtimeContextMessages.some((message) =>
        message.content.some(
          (block) =>
            block.type === "text" &&
            block.text.includes(
              "Injected context from completed subagent hooks:"
            ) &&
            block.text.includes("这是 hook 子代理整理出来的最终背景摘要。")
        )
      )
    ).toBe(true);
    expect(requests).toHaveLength(1);
  });

  test("does not inject materialized results after the hook configuration changes", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const traceManager = new MemoryTraceManager();

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            return {
              content: [{ type: "text" as const, text: "继续处理。" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 10,
                output_tokens: 6,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      traceManager,
      routineRepository: createMemoryRoutineRepository(),
      toolRegistry: new ToolRegistry(),
      userContextHooks: [
        {
          id: "hook-config-changed",
          event: "run_started",
          behavior: "subagent",
          waitMode: "unblocking",
          title: "新的背景资料",
          content: "这是已经改过的新 hook 配置。",
          enabled: true
        }
      ]
    });
    const staleHookConfigHash = getUserContextHookConfigHash({
      event: "run_started",
      behavior: "subagent",
      waitMode: "unblocking",
      title: "旧背景资料",
      content: "这是旧的 hook 配置。"
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/subagent-hook-config-change",
      userId: "hook-user"
    });

    await runtime.recoverSession({
      ...session,
      context: {
        ...session.context,
        hookContextEntries: [
          {
            hookId: "hook-config-changed",
            hookEvent: "run_started",
            waitMode: "unblocking",
            taskId: "task-old",
            title: "旧背景资料",
            configHash: staleHookConfigHash,
            content: "这是一条旧配置产出的结果，不应该再注入。",
            createdAt: "2026-05-01T00:00:00.000Z"
          }
        ]
      }
    });

    await runtime.run({
      sessionId: session.sessionId,
      message: "继续"
    });

    const promptEvent = traceManager.events.findLast(
      (event): event is Extract<TraceEvent, { kind: "prompt" }> =>
        event.kind === "prompt"
    );
    const runtimeTexts =
      promptEvent?.runtimeContextMessages.flatMap((message) =>
        message.content.flatMap((block) =>
          block.type === "text" ? [block.text] : []
        )
      ) ?? [];

    expect(
      runtimeTexts.some((text) =>
        text.includes("这是一条旧配置产出的结果，不应该再注入。")
      )
    ).toBe(false);
  });
});
