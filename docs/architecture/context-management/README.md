# Context 管理总纲

## 定位

这组文档记录 agent runtime 如何管理模型上下文，包括消息历史、assistant thinking、压缩、tool result、runtime context、dynamic prompt 与 prompt 设计。

它描述的是当前主链路和后续演进约束，不替代源码事实源。判断实现现状时仍以这些文件为准：

- prompt 拼装：`packages/agent/src/prompt.ts`
- runtime loop：`packages/agent/src/runtime/run-loop.ts`
- tool 执行：`packages/agent/src/runtime/tool-execution.ts`
- session block 类型：`packages/agent/src/types.ts`
- trace 事件结构：`packages/agent/src/trace.ts`

## 核心原则

### 1. 上下文分层

当前 prompt envelope 分为四层：

- `system`：稳定身份、行为边界和通用 runtime 约束
- `prefixMessages`：相对稳定的 session 前缀，例如工作目录、日期锚点、能力包和 mounted tools
- `messages`：用户、assistant、assistant thinking、tool call、tool result 的会话历史回放
- `runtimeContextMessages`：每次执行才注入的易变上下文，例如当前时间、timezone、session status、pending permission、pending confirmation、pending user question、workspace skills
- `dynamicPromptMessages`：当前仅用于 turn budget 逼近时的短促提示，不进入 cache key

设计新上下文时，先判断它属于哪一层。不要为了模型可见性把所有内容都塞进 `system`，也不要把易变执行态写入稳定前缀。

### 2. 会话历史是可恢复事实

`session.messages` 是多轮恢复和下一轮 prompt 回放的主要事实源。只要写入 session，就应假设后续轮次会依赖它。

因此：

- 用户输入写成 `user`
- assistant 可见文本写成 `assistant`
- 工具请求写成 `tool call`
- 工具反馈写成 `tool result`

权限、确认、interrupt 等运行态可以在 `session.context` / `session.sessionState` 中表达，只有当模型后续必须理解该事件时，才进入 `session.messages`。

### 3. compact 处理上下文大小，不处理任务终止

`compact` 的职责是降低 prompt 输入规模。它不是防无限循环、不是任务终止条件，也不是权限或业务确认机制。

用于判断是否接近或超过 `contextWindow` 的指标，语义上应视为“本次请求对上下文窗口的占用”，不是计费口径，也不是通用产品观测指标。

任务终止应由这些边界控制：

- `maxTurns`
- context window preflight
- tool / provider 错误
- interrupt
- waiting state
- completed / failed loop state

### 4. prompt cache 只依赖稳定前缀

当前 `cacheKey` 只 hash：

- `system`
- `prefixMessage`
- `tools`

`runtimeContextMessages` 不进入 cache key。新增上下文时，如果它会频繁变化，例如当前分钟级时间、pending payload、临时 skill diagnostics，就不应放进稳定前缀。

### 5. trace 保留可观测性

上下文治理必须能从 trace 复盘。`prompt` trace event 会记录：

- `system`
- `prefixMessages`
- `messages`
- `runtimeContextMessages`
- `dynamicPromptMessages`
- `compositionStats`（每 turn 的 prompt 字符组成统计，包含 `tool_result` / `thinking` / `runtimeContext` chars 与 top-N largest tool results）
- `tools`
- `toolChoice`
- `cacheKey`

发生 context 相关问题时，优先查看 trace 中模型实际收到的 prompt envelope，而不是只看 UI 展示或 session snapshot。

## 当前机制一览

| 领域 | 当前机制 | 入口文档 |
| --- | --- | --- |
| messages 回放 | `ConversationBlock[]` 转 Anthropic-compatible messages | [Messages 管理](./messages.md) |
| history compact | 超过 `contextWindow * 0.6` 后压缩较早历史，保留最近 tail | [Compact 机制](./compaction.md) |
| tool result | 默认完整写入 session，不做统一 runtime 截断 | [Tool Result 上下文](./tool-results.md) |
| prompt 分层 | `system + prefix + messages + runtime context + dynamic prompt + tools` | [Prompt 设计](./prompt-design.md) |
| planning 态 | session 级 `plan mode` + task brief artifact + 文件写拦截 | [Plan Mode](./plan-mode.md) |

## 新增上下文的决策顺序

1. 它是稳定规则、session 稳定事实，还是单次执行态？
2. 模型下一轮是否必须看到它？
3. 它是否会破坏 prompt cache 稳定性？
4. 它是否应该持久化到 session，还是只写 trace / runtime state？
5. 它过大时应该由工具语义缩减、history compact，还是需要单独设计新 compact？
6. 它是否有测试能覆盖 prompt envelope、session 恢复和 trace 可观测性？

## 不做的事

- 不把 `compact` 当作 loop 终止策略
- 不把所有 runtime 状态塞入 `system`
- 不在 runtime 层统一截断所有 tool result
- 不让 prompt cache key 包含分钟级时间、pending payload 等易变字段
- 不把 trace 当成 session 恢复事实源；trace 用于复盘，session 才是恢复事实源
