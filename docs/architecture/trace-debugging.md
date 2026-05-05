# Trace / Log 排查

这份文档只针对 `my-agent-proj` 当前 runtime 主链路，目标是让排查 trace 和 system log 时先看必要信息，再决定是否展开原始细节。

## 事实源

- trace 文件：`tmp/agent-sessions/sessions/<sessionId>.trace.jsonl`
- system log 文件：`tmp/agent-sessions/logs/system.log.jsonl*`
- trace API：`GET /sessions/:sessionId/trace`
- system log API：`GET /system-logs`

当前实现里：

- trace 负责复盘 runtime 实际发生了什么
- system log 负责补充 runtime / permission / api / worker 的结构化诊断
- session snapshot 仍然是恢复事实源，trace 不是恢复事实源

## 推荐排查顺序

### 1. 先列最近 session

```bash
bun run trace:inspect -- list --limit 10
```

优先看：

- 哪个 session 更新时间最新
- 总 turn 数和 event 数是否异常膨胀
- `last_state`
- `last_stop_reason`
- `error_turns`

### 2. 再看单个 session 概览

```bash
bun run trace:inspect -- inspect --session <sessionId>
```

默认输出会先给：

- session 基本信息
- 第一条用户消息
- 各类 event 计数
- 按 turn 排好的 timeline

这里通常已经足够回答这些问题：

- 卡在哪一轮
- 是 tool_use 停下来的，还是 run_error 失败的
- 有没有 permission / confirmation / user question 挂起
- 有没有 background notification 或 compact

### 3. 只展开你需要的部分

```bash
bun run trace:inspect -- inspect --session <sessionId> --include tool-output,logs
```

支持的 `--include` 值：

- `prompt`
- `response`
- `thinking`
- `tool-input`
- `tool-output`
- `permissions`
- `background`
- `compaction`
- `logs`
- `raw-errors`

## 常见用法

### 只看最近一次

```bash
bun run trace:inspect -- inspect --latest
```

### 只盯某一轮

```bash
bun run trace:inspect -- inspect --session <sessionId> --turn 3
```

### 只盯某个工具

```bash
bun run trace:inspect -- inspect --session <sessionId> --tool delegate_agent --include tool-input,tool-output,logs
```

### 只看异常相关 turn

```bash
bun run trace:inspect -- inspect --session <sessionId> --errors-only --include raw-errors,logs
```

### 检查 prompt 真正注入了什么

```bash
bun run trace:inspect -- inspect --session <sessionId> --turn 8 --include prompt,response --max-chars 4000
```

### 检查权限挂起链路

```bash
bun run trace:inspect -- inspect --session <sessionId> --include permissions,logs
```

### 检查后台任务 / delegation

```bash
bun run trace:inspect -- inspect --session <sessionId> --tool delegate_agent --include tool-input,tool-output,background,logs
```

## 默认输出怎么读

timeline 每一轮优先看这几列：

- `stop_reason`
- `loop_state`
- `tokens`
- `prompt_chars`
- `tools`
- `permissions`
- `fallbacks`
- `run_errors`

其中：

- `tools: xxx[pending]` 往往说明 tool call 后没有 result，要继续看 permission / interrupt / run_error
- `permission_request ...` 往往说明当前不是 runtime 坏了，而是正常进入等待用户输入
- `fallbacks` 往往说明模型输出或协议契约没有命中主路径
- `run_errors` 应该继续配合 `--include raw-errors,logs` 看堆栈和 system log

## 什么时候看 trace，什么时候看 system log

先看 trace：

- prompt 是否真的变了
- 模型是否发出了 tool_use
- tool result 是否是 error
- turn 是在哪个 stopReason 结束
- background notification 是否写入或消费

再看 system log：

- API / runtime / worker 在该 session 下具体报了什么结构化错误
- permission checker 之外的组件诊断
- 某次请求有没有 requestId / runId 线索

## 相关事实源

- `packages/agent/src/trace.ts`
- `packages/agent/src/system-log.ts`
- `packages/agent/src/runtime/`
- `apps/api/src/app.ts`
- `apps/api/src/observability-routes.ts`
- `apps/api/src/sessions-routes.ts`
- `apps/api/src/index.ts`
- `scripts/trace-log-inspector.ts`
