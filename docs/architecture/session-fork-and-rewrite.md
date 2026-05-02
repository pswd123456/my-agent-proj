# Session Fork 与 Rewrite

## 定位

这一层负责把“基于历史 assistant 结果开分支继续跑”和“回退最近一轮用户输入后改写重试”收敛成同一套历史锚点机制。

它解决的不是通用版本管理，而是 agent session 在当前运行主链路里的两个具体能力：

- `fork`：从某个 assistant 回合结束点复制出一个新的 child session，继续沿着同一段历史往下走
- `rewrite`：把当前 session 回退到某个用户回合开始前，让前端改写这条用户消息并重新提交

两者都依赖同一种持久化锚点：`session_fork_checkpoints`。

## 为什么单独存在

如果只靠 `session_messages`，可以还原“展示给用户的历史”，但不够稳定地还原“当时发给模型的 prompt envelope”。

这里额外保存 checkpoint，是为了同时保住两类事实：

- 这一轮 assistant 结束时的 session snapshot
- 这一轮真正发给模型的 prompt seed，包括 `system`、request messages、runtime context、tools 和 `toolChoice`

因此 fork / rewrite 的事实源是 session snapshot + checkpoint，而不是 trace 回放。

## 它负责什么

### 1. 在 turn 结束时落 checkpoint

`packages/agent/src/runtime/run-loop.ts` 会在一次 turn 正常收束后保存 fork checkpoint。这个 checkpoint 绑定 assistant message，并记录：

- `turnCount`
- `baseMessageCount`
- `snapshot`
- `promptSeed`
- `responseGroupId`

`baseMessageCount` 不是“当前 messages 总长度”，而是这轮用户输入开始前的消息边界。这样即便一轮里穿插了 tool call / tool result，后续也能回到真正的触发用户消息。

### 2. 从 checkpoint 创建 fork session

`POST /sessions/:sessionId/forks` 不会重放整段 trace，而是：

1. 找到目标 assistant message 对应的 checkpoint
2. 从 checkpoint snapshot 克隆出一个新 session
3. 写入 `parentSessionId`、`parentRelationKind="fork"`、`forkReplayCheckpointId`
4. 清空活跃后台通知、待审批态、pending tool call 和 interrupt 标记
5. 如当前 session 绑定了 task brief，则把 brief 复制到 fork session 自己的 `.agent/plans/<sessionId>/`

fork session 的第一轮不会重新走完整 prompt 拼装，而是优先读取 `forkReplayCheckpointId` 指向的 checkpoint，用当时的 `promptSeed` 和 checkpoint 之后的尾部消息重放请求，再在收束后清掉 replay marker。

### 3. 把 rewrite 限定为“最近一个可改写用户回合”

`GET /sessions/:sessionId/fork-targets` 不只返回可 fork 的 assistant 目标，还会返回一个 `rewriteTarget`。

当前 rewrite 规则很收敛：

- 只允许最近一个可改写的用户消息
- 只允许已经完成、且没有待审批 / 待确认 / 待提问 / pending tool call / interrupt 的 session
- hook 生成的 user message 不可改写
- 如果 run-end message hook 的内容与普通 user message 重合，也会优先避免把 hook 误判成 rewrite 目标

这意味着 rewrite 不是任意历史编辑器，而是“回退最近一轮真实用户输入，然后重试”的受限操作。

### 4. 在原 session 上做 rewind，而不是新开 child session

`POST /sessions/:sessionId/rewrite-target/recover` 会直接改写原 session：

1. 校验请求确实指向当前最新 rewrite target
2. 根据 checkpoint 找到触发这轮 assistant 的用户消息
3. 把 session messages 截断到该用户消息之前
4. 清空 `forkReplayCheckpointId`、`promptCacheKey`、待审批态、pending tool call、冲突摘要和 interrupt 标记
5. 重算 `firstUserMessage` / `lastUserMessage`
6. 把 turn 之后的 fork checkpoints 和 trace 一并裁掉
7. 用早于该 turn 的 trace usage 重算 `inputTokensCount`

恢复完成后，前端再把用户编辑后的新消息作为下一次正常提交发给同一个 session。

## 它不负责什么

- 不做任意时间点快照浏览或通用版本树管理
- 不保证所有历史 assistant message 都一定可 fork；前提是对应 checkpoint 已存在
- 不把 rewrite 做成对任意旧消息的自由编辑
- 不把 hook message、后台通知或 trace 结果伪装成 rewrite 输入
- 不让 fork / rewrite 绕开现有 session、trace、task brief 和权限边界

## 关键持久化边界

### `agent_sessions`

session 自身保存这几个关系字段：

- `parentSessionId`
- `parentRelationKind`
- `forkReplayCheckpointId`

它们用来表达“这个 session 是谁 fork 出来的”以及“下一轮是否需要按 checkpoint replay 一次”。

### `session_fork_checkpoints`

这张表保存历史锚点本体：

- `assistantMessageId`
- `turnCount`
- `baseMessageCount`
- `snapshotJson`
- `promptSeedJson`

唯一键是 `(session_id, assistant_message_id)`，意味着同一个 assistant message 对应一个最新 checkpoint 记录。

### `session_messages` 与 trace

- fork 会保留 checkpoint snapshot 里的消息历史，并给新 session 生成新的 message id
- rewrite 会裁掉目标 turn 之后的消息、trace 和后续 checkpoints
- trace 仍然只承担可观测性，不承担恢复事实源；这里只是借用既有 usage 统计来重算 `inputTokensCount`

## 前端怎么消费它

`apps/web/app/_components/session-workbench.tsx` 在 hydrate session 时会并行读取：

- `getSession()`
- `listSessionForkTargets()`

随后把这两类 affordance 映射到对话区：

- assistant 气泡旁显示 fork 动作
- 最新可改写 user message 显示 rewrite 动作

rewrite 交互不是“直接替换消息文本”，而是：

1. 调 `recoverRewriteTarget()` 回退 session
2. 用返回的新 session、forkTargets、rewriteTarget、traceRecords 重置本地状态
3. 再把用户编辑后的文本作为一次普通 `streamSessionExecution()` 提交

因此前端只负责工作台交互，不负责定义 checkpoint 或 rewind 语义。

## 相关模块

- API / SDK 边界：`apps/api/src/app.ts`、`packages/sdk/src/client.ts`
- runtime checkpoint 与 replay：`packages/agent/src/runtime/run-loop.ts`
- session fork / rewind helper：`packages/agent/src/session/checkpoint.ts`
- session 持久化：`packages/agent/src/session/postgres-session-manager.ts`
- 数据表：`packages/db/src/schema.ts`
- workbench 交互：`apps/web/app/_components/session-workbench.tsx`、`apps/web/app/_components/session-workbench-conversation.tsx`

## 推荐验证点

以后再刷新这篇文档时，优先核对这些事实源：

- `apps/api/tests/app-session-forks.test.ts`
- `packages/agent/tests/session-fork.test.ts`
- `apps/api/src/app.ts`
- `packages/agent/src/runtime/run-loop.ts`
- `packages/agent/src/session/checkpoint.ts`
