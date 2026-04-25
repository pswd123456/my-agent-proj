# Compact 机制

## 定位

compact 只负责控制 prompt 输入规模。它不负责停止 agent，不负责权限确认，也不负责修复模型重复调用工具。

当前默认启用的 compact 机制只有一类：`history compact`。

## 当前 history compact

`PromptBuilder.build()` 会先按完整 prompt envelope 估算输入 tokens。估算内容包括：

- `system`
- `prefixMessages`
- `messages`
- `runtimeContextMessages`
- `tools`
- `toolChoice`

当估算值大于 `Math.floor(session.contextWindow * 0.6)` 时，runtime 会对 `session.messages` 做 history compact，再重新转换成 provider messages。

当前触发比例是 `0.6`。它是提前压缩阈值，不是 provider context window 的硬上限。

## 压缩方式

当前 `compactHistoryBlocks()` 的策略是：

- 保留最近 `HISTORY_COMPACTION_TAIL_MESSAGES` 个 block
- tail 起点优先对齐到最近窗口里的 user block
- 如果最近窗口里没有 user block，则从 tail candidate start 开始保留
- 更早的 block 被总结成一个 synthetic `user` block
- synthetic block 的 id 是 `history-compaction-summary`

这个策略的目标是尽量保留最近行动链路，避免长 tool chain 中途把当前 search frontier 压掉。

## context window preflight

history compact 后，`run-loop` 仍会再次估算 prompt 输入。

如果估算值仍然大于 `session.contextWindow`，runtime 会在模型调用前失败，返回 `context_window_exceeded`，并把 session 标记为 failed。

因此当前上下文控制链路是：

1. 完整 prompt 估算
2. 超过 60% 阈值时做 history compact
3. compact 后再次估算
4. 仍超过 context window 时模型调用前失败

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

## 当前不做 full compact

当前仓库不做新的 runtime 级 full compact，也不做统一 tool-result-level compact。

如果未来要引入 full compact，需要先写清楚：

- 触发条件
- 是否写回 session
- 是否保留原始内容引用
- compact summary 的可信边界
- trace 如何记录 compact 前后的差异
- session recover 如何处理 compact 后历史

## 测试关注点

修改 compact 机制时，至少覆盖：

- 未超过 60% 阈值时不 compact
- 超过阈值时生成 `history-compaction-summary`
- 最近 tail 中没有 user block 时仍能保留 tail
- compact 后 `tool_use` / `tool_result` 仍合法配对
- compact 后仍超窗时返回 `context_window_exceeded`
