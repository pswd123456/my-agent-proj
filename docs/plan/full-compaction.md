# Full Compaction

更新时间：2026-04-26
状态：已落地
范围：`packages/agent` runtime preflight 的第二阶段上下文压缩

## 定位

`full compaction` 是当前 runtime 的第二阶段上下文压缩机制。

它的目标只有一个：

- 在长任务接近 context window 上限时，主动清空大部分历史消息
- 同时保留一份可继续工作的 continuation summary

它不是：

- `plan mode` 的一部分
- `task brief` artifact
- 通用 memory subsystem
- tool 级统一截断的回归版本

## 当前触发路径

当前 preflight 阈值统一是 `95%` 的 `session.contextWindow`。

运行顺序如下：

1. 先组完整 prompt，估算 tokens
2. 第一次超过 `95%`
   - 触发一次 `history compaction`
   - 写回压缩后的 `session.messages`
   - `historyCompactionsSinceFullCompaction = 1`
3. 再次超过 `95%`
   - 触发一次 `full compaction`
   - 生成 continuation summary
   - `session.messages` 只保留最近短尾
   - `historyCompactionsSinceFullCompaction = 0`
4. full compaction 后重新 build prompt
5. 如果仍然超过 `contextWindow`，再返回 `context_window_exceeded`

这意味着：

- `history compaction` 在两次 full compaction 之间只允许成功一次
- `full compaction` 不会在同一轮后继续递归触发新的 history compaction

## 持久化状态

当前实现新增两份 session 状态：

### `session.sessionState.historyCompactionsSinceFullCompaction`

- 类型：`number`
- 默认值：`0`
- 含义：自上次 full compaction 以来，history compaction 已成功执行几次
- 当前实现只使用 `0` 和 `1`

### `session.context.fullCompactionState`

结构：

```ts
{
  summaryMarkdown: string;
  compactedAt: string;
  promptVersion: string;
  sourceBlockCount: number;
  retainedTailCount: number;
}
```

它是 full compaction 的主事实源，不依赖 `taskBriefPath`。

## continuation summary

full compaction 会调用一条专门的 compact prompt，输出固定 Markdown 骨架：

- `## Goal`
- `## Constraints`
- `## Verified Facts`
- `## Decisions`
- `## Current Frontier`
- `## Next Checkpoint`

它参考了 task brief 的组织方式，但和 planmode 解耦：

- 不要求 plan mode 开启
- 不读写 `replace_task_brief` / `get_task_brief`
- 不把 task brief 当作默认输入

输入来源只包含：

- 更早历史里的 `user`
- 更早历史里的 `assistant`
- 更早历史里的 `tool call` 参数

明确不包含：

- `tool result` 正文
- `assistant thinking`
- thinking signature

## full compaction 后的 message 保留

当前 full compaction 后，`session.messages` 只保留最近 `6` 个可直接回放的 block：

- 保留：`user`
- 保留：`assistant`
- 保留：`tool call`
- 丢弃：`tool result`
- 丢弃：`assistant thinking`

这里按保留下来的 block 计数，不按原始 block 计数。

因此 continuation state 的承接主轴是：

1. `fullCompactionState.summaryMarkdown`
2. 最近 `6` 个可回放 block

## prompt 注入

普通 prompt 组装时，如果 session 上存在 `fullCompactionState`：

- runtime 会在 `runtimeContextMessages` 里追加一条 continuation summary message
- 注入内容包括 compact 时间、prompt version、source/tail 计数和 summary markdown
- 它不进入 stable prefix，也不进入 cache key

这和当前 `task brief` 的边界不同：

- `task brief` 仍是 planning artifact
- `full compaction` summary 是 runtime continuation state

## trace

当前 trace 会记录两类事件：

### `history_compaction`

- `thresholdTokens`
- `estimatedInputTokensBefore`
- `estimatedInputTokensAfter`
- `sourceBlockCount`
- `retainedTailCount`

### `full_compaction`

- `thresholdTokens`
- `estimatedInputTokensBefore`
- `estimatedInputTokensAfter`
- `sourceBlockCount`
- `retainedTailCount`
- `promptVersion`
- `summaryMarkdown`

## 与 task brief 的关系

`task brief` 仍然成立，但它不再是 full compaction 的依赖前提。

当前关系应理解为：

- task brief：用户可编辑的 planning artifact
- full compaction summary：runtime 自动生成的 continuation state

它们可以参考相似骨架，但不是同一份状态。
