# Prompt 设计

## 当前 prompt envelope

`PromptBuilder.build()` 当前返回：

- `system`
- `prefixMessages`
- `messages`
- `runtimeContextMessages`
- `dynamicPromptMessages`
- `tools`
- `cacheKey`

`run-loop` 发送 provider request 时，会把 message 顺序组装为：

```text
prefixMessages
messages
runtimeContextMessages
```

`system` 作为 provider request 的独立 system 字段发送，`tools` 作为工具定义发送。

## system

`system` 放稳定、长期有效的 runtime 行为边界。

适合放入 `system`：

- assistant 身份和运行模式
- 工具面是动态 mounted 的事实
- 工具输入错误后的修正策略
- 行动前输出短意图的要求
- 像 `search_text -> 局部 read_file`、`read_file offset/limit` 这种稳定工具使用硬约束（需要用 `MUST` 明确约束时也放这里）
- 权限和 YOLO mode 的高层行为边界
- skills 只能使用 runtime context 中列出的事实

不适合放入 `system`：

- 当前分钟级时间
- pending confirmation payload
- pending permission request
- workspace skill 列表
- 某次执行的临时诊断
- 产品专项长规则，除非 capability pack 已明确挂载并需要注入

## prefixMessages

`prefixMessages` 放相对稳定的 session 前缀，当前包括：

- workspace root
- current date context
- YOLO mode
- enabled capability packs
- mounted tools summary

prefix message 带 `cache_control: { type: "ephemeral" }`，并参与当前 `cacheKey` 计算。

新增 prefix 内容时要谨慎：只要内容频繁变化，就会降低 prompt cache 命中稳定性。

## messages

`messages` 是从 `session.messages` 转出的对话历史。

它承担：

- 用户意图回放
- assistant 文本回放
- assistant thinking 回放（仅限 provider 需要续传的 signed reasoning）
- tool call / tool result 配对
- 多轮恢复

不要把与模型推理无关的 UI lifecycle event 写入这里。否则会污染模型上下文，也会放大 compact 压力。

## runtimeContextMessages

`runtimeContextMessages` 放每次执行才需要的易变上下文，当前包括两类：

1. runtime context
   - current local datetime
   - current timezone
   - working directory
   - session status
   - YOLO mode
   - pending permission request
   - pending confirmation payload
   - pending user question payload

2. workspace skills
   - 从 `session.workingDirectory/.agent/skills/` 发现的 skill metadata
   - 当前只暴露模型需要选择技能的元信息

这层不参与 `cacheKey`。如果新增信息会随执行变化，优先放这里。

另外还有一组 `dynamicPromptMessages`，当前只用于 turn budget 逼近时的短促提示，例如“尽量收束工作、避免继续探索”。实现上它们会并入本轮 runtime context 的文本层，跟随上下文一起注入，但同样不进入 `cacheKey`，也不应该被提升到稳定前缀。

## tools

`tools` 来自当前 `ToolRegistry` 的 Anthropic-compatible tool definitions。

模型只能使用这次 request 中实际 mounted 的工具。prompt 中不要暗示隐藏工具或未挂载能力。

capability pack 的专项规则应跟 mounted tools 对齐：没有挂载对应工具时，不应注入让模型执行该能力的长规则。

## cacheKey

当前 cache key 计算范围是：

```text
sha256(system + prefixMessage + tools)
```

不包含：

- `messages`
- `runtimeContextMessages`
- `dynamicPromptMessages`
- 当前 turn 的 pending payload
- skills diagnostics

新增 prompt 内容时，需要先判断它是否应该影响 cache key。如果不应该，就不要放入 `system` 或 `prefixMessages`。

## 设计检查清单

改 prompt 前先问：

1. 这是稳定规则、session 稳定事实，还是单次执行态？
2. 它需要持久化吗？
3. 它是否会频繁变化并破坏 cache 稳定性？
4. 它是否只在某个 capability pack 挂载时才成立？
5. 它是否能通过 trace 的 `prompt` event 直接验证？
6. 它是否会让模型重复长计划，而不是输出短意图后行动？

## 常见反模式

- 把当前时间写进 stable prefix
- 把 pending permission 同时写进 messages 和 runtime context，造成双重语义
- 在通用 system prompt 中保留某个产品能力的长规则
- 把 UI 展示状态当成模型需要推理的对话历史
- 为了减少上下文把 tool result 在 session 写入前统一截断
- 只改 prompt 文案，不检查 trace 中 provider payload 是否真的变化
