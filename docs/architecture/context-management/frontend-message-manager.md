# 前端 Message Manager

## 定位

`apps/web` 的消息展示现在通过一个统一的前端 message manager 收口，不再让 conversation、compact view、inspector 各自直接拼接 `session.messages`、trace 和 streaming 事件。

它的职责是把三类事实源合并成一套稳定 projection：

- `session.messages`：持久化会话消息，作为前端恢复事实
- trace / history events：诊断用最终态事件
- stream events：当前运行中的增量事件 overlay

目标不是改变 runtime 语义，而是让前端始终只围绕一份“消息账本”做 dedupe、排序、折叠和 inspector 派生。

## 输入与输出

message manager 接收：

- 当前 `SessionSnapshot`
- 当前 session 的 `TraceRecord[]`
- 当前运行中的 stream events
- pending user message
- 本地视图状态：展开项、自动折叠中的项、最近完成动画的 assistant/thinking key

它输出两组 projection：

- `ConversationProjection`
  - timeline items
  - compact/debug conversation items
  - visible items
  - stream keys / animation keys
  - collapsed flow anchors
- `InspectorProjection`
  - inspector events
  - prompt / thinking / tools / trace 所需的派生结果

`SessionWorkbench` 只维护 manager state，然后把 projection 传给 conversation panel 和 inspector drawer。

## 合并规则

### 1. 去重

- assistant text 按稳定 `assistantMessageId` 合并 streamed snapshot 和 persisted assistant block
- thinking 按 `thinkingMessageId`，回退到 `signature`
- tool call / permission / tool result 按 `toolCallId` 合并成单条执行流

这样 refresh 之后，即使 persisted session 已经带回最终消息，stream overlay 也不会再额外渲染一份重复块。

### 2. 排序

manager 对外只暴露单一顺序：

- turn boundary
- user
- thinking
- assistant text
- tool / permission execution flow
- terminal events

如果 trace 到达时间晚于 assistant snapshot，仍以 turn 内 narrative order 为准，而不是简单按 `createdAt` 重排。

### 3. 折叠

compact 模式的折叠逻辑也在 manager 内完成：

- 判断某段 execution flow 是否可折叠
- 记录 collapsed flow 对应的 scroll target
- 记录自动折叠期间需要临时隐藏的 assistant item

组件层只负责动画、滚动和 DOM 观察，不再自行推导哪些消息该折叠、隐藏或对齐。

## 边界

- trace 仍然是诊断用最终态，不作为会话恢复事实
- stream events 仍然允许增量展示，但只通过 manager 进入 UI
- scroll、ResizeObserver、typewriter 帧推进仍留在组件层
- session status、permission waiting、pending question 仍由现有 session UI state 管理，不混进 message ledger
