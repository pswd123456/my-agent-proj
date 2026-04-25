# Messages 管理

## 目标

messages 管理要解决两个问题：

1. session 中保存的历史能稳定恢复下一轮运行
2. provider payload 中的 `tool_use` / `tool_result` 能保持合法配对

当前实现把内部会话历史建模为 `ConversationBlock[]`，再由 `toAnthropicMessages()` 转成 Anthropic-compatible messages。

## 内部 block 类型

`packages/agent/src/types.ts` 中的 `ConversationBlock` 当前包括：

- `user`：用户输入
- `assistant`：assistant 文本
- `tool call`：模型发起的工具请求
- `tool result`：工具执行后的反馈

这些 block 是 session 恢复和后续 prompt 回放的基础。新增消息类状态时，先判断它是否真的属于模型可见对话历史；如果只是 UI 或 runtime 控制态，应优先放在 `session.context`、`session.sessionState` 或 trace event。

## 转换规则

`toAnthropicMessages()` 的核心转换规则是：

- `user` block 独立转换成 user message
- 连续 `assistant` block 合并到 assistant message
- `tool call` block 转为 assistant message content 中的 `tool_use`
- `tool result` block 转为 user message content 中的 `tool_result`
- `tool_result.tool_use_id` 必须对应之前的 `tool_use.id`

这条映射是 provider payload 的关键边界。未来如果出现 provider 400，例如 `tool result's tool id not found`，优先检查这里的序列化结果和 `toolCallId` 连续性。

## tool call 与 permission 的关系

当前 `executeToolAction()` 会先把 `tool call` block 写入 `session.messages`，再做 permission check。

这意味着：

- 如果 permission 直接 block，会追加一个错误 `tool result`
- 如果 permission 进入 ask user，会保留已经写入的 `tool call`，并把 pending request 写入 session context
- 用户批准后，runtime 通过 `skipAppendToolCall` 复用之前的 tool call，再追加真实 tool result

这是当前实现事实，不代表长期唯一选择。后续如果要收紧“未批准 tool call 是否进入模型可见历史”，应单独设计 pending tool proposal 状态，而不是直接删除现有 block 写入。

## 消息历史与运行态边界

推荐边界：

- 会影响模型下一步推理的事实，进入 `session.messages`
- 会影响 runtime resume / UI gate 的状态，进入 `session.context` 或 `session.sessionState`
- 只用于排查和审计的细节，进入 trace

典型例子：

- 用户自然语言输入：`session.messages`
- assistant 对用户说出的文本：`session.messages`
- 已执行工具的结果：`session.messages`
- pending confirmation payload：`session.context`
- pending permission request：`session.context`
- streaming 中间文本：trace / event stream，最终需要保留的文本再进入 session

## 测试关注点

修改 messages 管理时，至少检查：

- `tool_use` 与 `tool_result` 的 id 是否连续
- `text + tool_use` 同轮响应能否在下一轮完整回放
- 多个 tool call 是否按顺序执行和回放
- permission approve / reject 后 session 状态和 message 历史是否一致
- history compact 后最近 tail 是否仍保留足够行动上下文
