# Stage 2: reasoning-aware loop + multi-tool turn + trace

## 文档状态

这份文档保留 Stage 2 的 reasoning / trace 演进草稿，不是当前实现的唯一事实源。现在的 runtime 仍保留 signed `assistant thinking` 的回放能力，具体行为以 `docs/architecture/context-management/` 和 `packages/agent/src/` 为准。

## 目标
- 支持模型在一次响应里同时返回 `text` 和 `tool_use`。
- 支持一次响应里多个 `tool_use`，并按返回顺序逐个执行。
- `thinking` / reasoning 记录在 trace 中；对于需要续传的 signed `assistant thinking`，runtime 会保留并在后续轮次按协议回放，而不是当成普通 assistant prose。
- `maxTurns` 不再硬报错，改为基于当前步骤生成 fallback answer。

## 核心方案
- `packages/agent/src/prompt.ts`
  - 以 conversation block 为输入，回放时按 turn 分组。
  - 连续的 `assistant` + `tool call` 合并成一个 assistant message。
  - 连续的 `tool result` 合并成一个 user message。
  - 这样一次响应里出现 `text + tool_use` 时，下一轮模型能看到完整同轮上下文。
  - prompt 要显式区分稳定 prefix 和本轮动态 runtime context。
  - 历史草稿曾计划把 `workspace root`、`current_date_context`、tool schema 放进稳定 prefix；当前实现已经移除默认日期注入，只保留工作目录、YOLO mode、capability packs 与 mounted tools summary 等稳定前缀。
  - 当前日期、当前时间和 timezone 不再自动进入 runtime context；模型需要这些信息时，应显式调用 `get_current_time`。pending confirmation 等易变信息仍放在本轮 runtime context message，不进入 cache key。
- `packages/agent/src/runtime.ts`
  - 逐块处理模型返回的 content。
  - `text` 追加进 session.messages，并写入 trace。
  - `thinking` 只写 trace，不回灌 session.messages。
  - `tool_use` 追加成 tool call block，收集后按顺序执行。
  - 一次响应多个 tool call 时，全部执行完再进入下一轮。
  - 每轮更新 `turnCount`、`pendingToolCallIds`、`lastError`、`loopState`。
  - 单次 `execute` 开始时固定一份 `requestStartedAt` / runtime time context；同一次 run 内即使发生多次 tool 往返，也保持这份时间上下文不变。
- `packages/agent/src/trace.ts`
  - 追加式 JSONL trace，存放在 `tmp/agent-sessions/sessions/<sessionId>.trace.jsonl`。
  - 记录 `turn_start`、`prompt`、`response`、`thinking`、`assistant_text`、`tool_call`、`tool_result`、`fallback`、`turn_end`。
  - `prompt` 事件保存模型本轮真实看到的 system / prefix / messages / tools。
- `apps/api/src/index.ts`
  - API 负责暴露只读 `GET /sessions/:sessionId/trace`，便于直接观察上下文。

## maxTurns fallback
- 当 turn budget 耗尽时，不返回错误。
- 用当前 session 的最近若干 steps、lastError、pendingToolCallIds 生成一段确定性的 fallback answer。
- 将这段 fallback answer 追加进 session.messages，状态置为 `completed`。
- 返回 `stopReason = "max_turns"`，便于上层区分“正常结束”和“预算耗尽”。

## 验收
- 单次 response 可同时含 `text` 和 `tool_use`，且下一轮 prompt 能正确回放。
- 单次 response 可含多个 `tool_use`，工具按顺序全部执行。
- `thinking` 会出现在 trace 中，必要时也会以 `assistant thinking` block 的形式进入会话历史。
- `maxTurns` 耗尽时，返回 fallback answer 而不是抛错。
- API 能直接读取同 session 的 trace 文件。

## 默认假设
- reasoning 采用 provider 原生的 `thinking` block。
- 多 tool call 先顺序执行，不做并行化。
- fallback answer 采用本地 deterministic 汇总，不额外再发模型请求。
