# Compact 机制

## 定位

compact 只负责控制 prompt 输入规模。它不负责停止 agent，不负责权限确认，也不负责修复模型重复调用工具。

当前默认启用的 compact 机制有两类：

- `history compact`
- `full compaction`

## 当前 history compact

`PromptBuilder.build()` 会先按完整 prompt envelope 估算输入 tokens。估算内容包括：

- `system`
- `prefixMessages`
- `messages`
- `runtimeContextMessages`
- `tools`
- `toolChoice`

当估算值大于 `Math.floor(session.contextWindow * 0.95)` 时，runtime 会先对 `session.messages` 做 history compact，再重新转换成 provider messages。

当前触发比例是 `0.95`。它是提前压缩阈值，不是 provider context window 的硬上限。

## 压缩方式

当前 `compactHistoryBlocks()` 的策略是：

- 保留最近 `HISTORY_COMPACTION_TAIL_MESSAGES` 个 block
- tail 起点优先对齐到最近窗口里的 user block
- 如果最近窗口里没有 user block，则从 tail candidate start 开始保留
- 更早的 block 被总结成一个 synthetic `user` block
- synthetic block 的 id 是 `history-compaction-summary`

这个策略的目标是尽量保留最近行动链路，避免长 tool chain 中途把当前 search frontier 压掉。

## context window preflight

当前 preflight 链路在 `run-loop`，不是 `PromptBuilder.build()`。

运行顺序如下：

1. 组完整 prompt，估算 tokens
2. 超过 `95%` 且 `historyCompactionsSinceFullCompaction = 0` 时，执行一次 history compact
3. 再次超过 `95%` 时，执行一次 full compaction
4. full compaction 后重建 prompt
5. 如果估算值仍然大于 `session.contextWindow`，runtime 会在模型调用前失败，返回 `context_window_exceeded`，并把 session 标记为 failed

这里关心的核心语义是“上下文窗口占用”，不是计费口径，也不是通用埋点口径。换句话说，只要某部分输入仍然占用 provider 的 prompt window，它就应该被纳入这个控制指标，即使 provider 把它记作 cache read / cache write，而不是新的 raw input token。

因此在调试或 workbench 中查看 `ctx` / `peak ctx` 之类的值时，应把它理解为：

- 用来判断是否接近 `contextWindow` 上限
- 用来解释为何会触发 compact 或 `context_window_exceeded`
- 不是账单金额的直接代理
- 也不是跨模型、跨 provider 横向比较的通用观测 KPI

因此当前上下文控制链路是：

1. 完整 prompt 估算
2. 超过 95% 阈值时，最多先做一次 history compact
3. 仍超过 95% 时做 full compaction
4. full compaction 后再次估算
5. 仍超过 context window 时模型调用前失败

## 与 termination 的边界

compact 不等于停止条件。

停止或等待应由以下机制表达：

- `maxTurns`
- `interrupt`
- `waiting_for_permission`
- `waiting_for_conflict_confirmation`
- provider / tool error
- `context_window_exceeded`
- assistant 最终回答并完成

如果模型进入重复工具调用，优先排查：

- tool call / tool result 是否正确回放
- compact 后最近 tail 是否保留了关键反馈
- provider payload 中 `tool_use_id` 是否连续
- 工具错误是否给了可修正信息

不要把重复循环直接归因于 compact 本身，也不要用 compact 替代 loop guard。

## 当前 full compaction

当前仓库已经有 runtime 级 full compaction，但仍然不做统一 tool-result-level compact。

当前 full compaction 的实现边界是：

- continuation summary 写入 `session.context.fullCompactionState`
- `session.messages` 只保留最近 6 个 `user` / `assistant` / `tool call`
- `tool result` 正文不进入 compact prompt，也不保留在 compact 后 tail
- summary 通过 `runtimeContextMessages` 注入，不进入 stable prefix / cache key

实现细节见 [docs/plan/full-compaction.md](../../plan/full-compaction.md)。

## 测试关注点

修改 compact 机制时，至少覆盖：

- 未超过 95% 阈值时不 compact
- 超过阈值时生成 `history-compaction-summary`
- history compact 在两次 full compaction 之间只成功一次
- 再次超过阈值时触发 full compaction
- full compaction 后 `runtimeContextMessages` 注入 continuation summary
- full compaction 后 `session.messages` 只保留最近 6 个允许回放的 block
- 最近 tail 中没有 user block 时仍能保留 tail
- compact 后 `tool_use` / `tool_result` 仍合法配对
- compact 后仍超窗时返回 `context_window_exceeded`
