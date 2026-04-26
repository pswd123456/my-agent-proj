# Tool Result 上下文

## 当前结论

当前 runtime 不再做统一的 tool result 截断或压缩。

工具执行完成后，`executeToolAction()` 会把工具返回的 `result.content` 原样写入 `session.messages` 的 `tool result` block，并在 trace 中记录同一份输出。

这条规则的含义是：

- session 历史保留工具原始反馈
- 下一轮模型能看到完整 tool result
- trace 可复盘工具真实输出
- runtime 层没有统一 `head/tail` 截断机制
- 需要压大结果时，优先由具体工具做语义级分页、stub 或降级，而不是由 runtime 统一裁剪

## 为什么不做统一截断

统一 tool result compaction 的问题是它不理解工具语义。

不同工具输出的保真重点不同：

- `read_file` 可能需要行号和相邻上下文
- `search` 需要命中片段、文件路径和数量上限
- `shell` 往往需要 stderr、exit code 和最后失败段
- 结构化业务工具需要保留 schema 语义

如果 runtime 在写入 session 前机械截断，中段信息会直接丢失，后续轮次无法从 session 恢复。

## 推荐治理方向

后续处理大 tool result，只走两条路径之一。

### 1. 工具内部按语义控制输出

优先让工具自己返回适合模型使用的结果。

例子：

- 文件读取工具支持行窗、`offset/limit` 分页、路径校验、单次读取超过 `25_000 tokens` 直接报错，并在超限时明确引导“先 `search_text` 定位，再局部 `read_file`”，以及“同文件同范围未变化时返回 unchanged stub”
- 搜索工具返回 top matches、周边片段和结果总数
- shell 工具保留 exit code、stderr 摘要和尾部输出
- 业务工具返回结构化 JSON，而不是长自然语言 dump

这类处理发生在工具语义层，不是 runtime 统一截断。

### 2. 单独设计 full compact

如果工具内部控制不够，需要单独设计 full compact，而不是复活统一 tool output compaction。

full compact 至少要定义：

- 原始内容在哪里保留
- summary 是否写回 session
- 模型如何引用被压缩内容
- trace 如何保留 compact 证据
- 超窗时的失败边界

## 与 trace 的关系

trace 的职责是复盘实际发生的事。tool result 事件应继续记录工具输出、错误状态和展示文本。

如果未来引入工具语义缩减或 full compact，应在 trace 中能看到：

- 原始工具输出或可定位引用
- 写入 session 的内容
- 写给模型的内容
- compact / shrink 发生的原因

## 与 history compact 的关系

即使单条 tool result 原样进入 session，prompt 构建时仍可能触发 history compact。

区别是：

- tool result 写入时不被 runtime 统一截断
- prompt 过大时，较早历史会被 history compact 总结

因此当前默认策略是“session 尽量保真，prompt 构建时按历史维度压缩”。

## 测试关注点

修改 tool result 管理时，至少检查：

- tool result 写入 session 的内容没有被 runtime 统一截断
- trace 中 tool result 输出可复盘
- provider payload 中 `tool_result.tool_use_id` 正确对应 tool call
- 工具错误结果能给模型下一步可修正信息
- 大输出治理发生在具体工具或单独 full compact 设计里
