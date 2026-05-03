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
runtimeContextMessages
messages
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
- skills 只能使用 runtime context 中列出的事实

不适合放入 `system`：

- 当前日期
- 当前分钟级时间
- timezone
- pending confirmation payload
- pending permission request
- YOLO mode 或 permission rules 这类工具权限状态
- workspace skill 列表
- 某次执行的临时诊断
- 产品专项长规则，除非 capability pack 已明确挂载并需要注入

## prefixMessages

`prefixMessages` 放相对稳定的 session 前缀，当前包括：

- workspace root
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

`runtimeContextMessages` 放每次执行才需要的上下文，并在层内按相对稳定到易变排序，当前包括七类：

1. plan mode prompt
   - 只在当前 session 开启 `plan mode` 时注入
   - 用来给模型一组只属于本轮 planning 态的执行规则
   - 当前会强调：todo 工具不可用、优先通过 `search_task_brief / read_task_brief / edit_task_brief / replace_task_brief` 维护 brief、普通 workspace 文件写工具不可用

2. user custom prompt
   - 来自 user settings 里的 `userCustomPrompt`
   - 只作为 runtime context 注入，不进入 `system`、`prefixMessages` 或 `cacheKey`
   - 适合承载长期偏好、回答约束或固定执行提醒

3. workspace instructions
   - 从 `session.workingDirectory/AGENTS.md` 读取的工作区根指令
   - 由 workspace instructions manager 负责扫描和诊断，prompt builder 只负责渲染
   - 不进入 `prefixMessages` 或 `cacheKey`，避免工作区指令变化影响稳定前缀

4. user context hooks
   - 来自 user settings 里的 `userContextHooks`
   - `behavior: "context"` 的 hook 由 runtime 在每次 run 开始时解析，只进入 `runtimeContextMessages`
   - context 注入当前只支持 `session_started`、`run_started` 两个时机；`run_end` 不支持 context hook，但支持 message / subagent
   - `session_started` 只在当前 session 的第一次 run 注入；同一轮内的显示顺序固定为 `session_started -> run_started`
   - hook 文本不进入 `system`、`prefixMessages` 或 `cacheKey`

`behavior: "message"` 的 hook 不进入 prompt runtime context，而是作为真实用户消息排入 runtime：`session_started` 与 `run_started` 会在用户消息发送给模型前先执行，`run_end` 会在用户消息完成后执行。`session_started` message hook 也只在当前 session 的第一次 run 触发。

`behavior: "subagent"` 的 hook 也不进入 stable prefix。`session_started` / `run_started` 会在首个主模型请求前进入 pre-prompt 调度阶段；`run_end` 则会在当前 run 完成后异步调度：

- hook child session 只收到 hook 自己的 `content` 作为任务正文，不带当前用户消息，也不带最近会话摘要
- 主会话只消费 hook child 的 `final response`；如果 child 进入 `needs_main_agent`、权限请求、澄清请求或没有 final response，都视为 hook 失败
- `waitMode: "blocking"` 时，父 run 会先挂起，等 hook 完成后通过现有 `background_task_poll -> session_wakeup` 链路，用原始用户消息恢复同一轮请求
- `waitMode: "unblocking"` 时，父 run 先继续；hook 完成后会先落到 `pendingBackgroundNotifications`，再在下一次真正发给模型的 run 前物化为 `session.context.hookContextEntries`
- `run_end` subagent hook 固定按 `unblocking` 执行：主会话先完成当前回答，再把 hook 作为后台任务排队，结果留给后续 run 注入
- prompt 注入只读取“当前仍启用且配置哈希匹配”的 `hookContextEntries`，避免用户禁用或改配后继续吃旧结果
- 注入顺序固定为：持久的 `session_started` 结果在前，累积的 `run_started` / `run_end` 结果按生成时间追加在后

5. workspace skills
   - 从 `session.workingDirectory/.agent/skills/` 发现的 skill metadata
   - prompt 当前只暴露模型做技能选择需要的元信息
   - 具体 skill 正文通过 `search_skill` / `load_skill` 按需读取，而不是整篇预注入

6. full compaction continuation summary
   - 只在 `session.context.fullCompactionState` 存在时注入
   - 内容来自最近一次 full compaction 生成的 continuation summary
   - full compaction 会把当时累积的非 `session_started` subagent hook 结果并入 continuation summary，再把 live `hookContextEntries` 裁到只剩 `session_started`
   - 不进入 `prefixMessages` 或 `cacheKey`

7. runtime context
   - working directory
   - pending confirmation payload
   - pending user question payload
   - active background task count
   - pending background notifications
   - completed subagent hook results（经 `hookContextEntries` 物化后）

这层不参与 `cacheKey`。如果新增信息会随执行变化，优先放这里。不过当前日期、当前时间和 timezone 不自动注入 runtime context；模型需要时应显式调用 `get_current_time`。

工具权限相关状态不进入模型可见 context，包括 YOLO mode、pending permission request、permission rules、`waiting_for_permission` 这类 session status，以及需要 permission decision 的后台通知。权限决策由 runtime / UI gate 处理，trace 和 session context 负责保留可观测性。

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
- 当前日期、当前时间和 timezone；这些只能通过 `get_current_time` 工具按需读取

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
- 把当前日期、当前时间或 timezone 默认注入 runtime context，导致所有请求都携带易变上下文
- 把 pending permission 同时写进 messages 和 runtime context，造成双重语义
- 把 YOLO mode、permission rules、pending permission request 放进 prompt，让模型基于权限态推理
- 在通用 system prompt 中保留某个产品能力的长规则
- 把 UI 展示状态当成模型需要推理的对话历史
- 为了减少上下文把 tool result 在 session 写入前统一截断
- 只改 prompt 文案，不检查 trace 中 provider payload 是否真的变化
