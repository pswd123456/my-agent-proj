# Todo Tool 设计草案

更新时间：2026-04-26
状态：已落地
范围：`packages/agent` runtime planning helper / session state / prompt 消费边界 / tool contract

## 目标

- 给 runtime 增加一个轻量级的多步任务跟踪能力，减少 agent 在长链路任务中的跑偏、漏步骤和重复探索。
- 让 agent 能在当前 session 内维护一份结构化 todo，而不是只把计划散落在普通 assistant 文本或历史 tool result 里。
- 保持和现有 prompt 分层、session 持久化、tool registry、trace 可观测性一致，不引入新的“第二套 runtime”。

## 一句话定义

todo tool 的第一版应被定义为 `session-scoped planning primitive`：

- 它服务于 runtime 的多步执行，不是一个独立产品 capability
- 它通过一组内置工具维护当前 session 的 todo state
- 它把 todo 真相源保留在 session state，并通过 planning tool result 显式暴露给模型
- 它不依赖“每五轮提醒一次”这类固定频率的 prompt hack

## 背景

当前 runtime 已有几层明确边界：

- `system`：稳定、长期有效的行为规则
- `prefixMessages`：相对稳定的 session 前缀事实
- `messages`：对话历史与 tool call / tool result 回放
- `runtimeContextMessages`：本轮执行态、易变上下文

现有设计文档已经明确：

- 不应把易变状态或临时诊断塞进 `system`
- capability pack 的专项规则应和 mounted tools 对齐
- prompt 不能暗示未挂载的隐藏能力

因此，todo 不能简单理解成：

1. “一个 capability pack”
2. “在 system prompt 里强调一下”
3. “每五轮补一句 reminder”

这三种做法都会和当前架构边界冲突。

## 本次决策

### 1. todo 不是独立 capability pack

第一版把 todo 定位为 runtime 内置 planning helper，而不是像 `schedule` 那样的领域 capability pack。

原因：

- 它不代表某个面向用户的业务域
- 它主要服务 agent 自身的多步执行质量
- 当前 runtime 的真实入口仍然是 flat `ToolRegistry`，不是 pack 自身

如果后续需要按 capability pack 开关 todo，也应理解为“是否挂载 planning helper 工具”，而不是给它单独建一套领域层。

### 2. todo 不进入通用 system prompt 长规则

第一版不把 todo 列表本身、todo 明细状态或“记得坚持任务”这类提醒写进通用 `system`。

允许进入 `system` 的最多只有一条稳定高层约束，例如：

```text
When a structured todo list is available, use it to stay aligned with the current task and keep item status updated as you make progress.
```

但 todo 的具体内容、当前进行中项、剩余未完成项，不应再和 tool result 回放重复注入到 `runtimeContextMessages`。

### 3. 不做固定频率 reminder

第一版不采用“每五轮自动追加 reminder”。

改为状态驱动消费：

- 当 session 中存在未完成 todo 时，模型通过最近的 todo tool result 或显式 `get_todo_list` 重新对齐
- 当 todo 为空或所有 item 已完成时，不额外注入 todo 摘要
- 当 turn budget 接近耗尽时，允许和现有 `dynamicPromptMessages` 一起出现，但二者是并列机制，不互相替代

原因：

- reminder 频率不应凭常数拍脑袋决定
- 当前 repo 已有 `currentTurnCount / maxTurns` 驱动的动态提醒
- 固定轮次提醒容易形成噪音，并放大上下文污染

### 4. todo 真相源必须是 session state

第一版不能只靠历史 assistant 文本或旧 tool result 作为 todo 的事实来源。

原因：

- `messages` 会被 compact
- 旧 tool result 可能被摘要化
- 模型从摘要中反推结构化 todo，可靠性不够

因此 todo 必须有明确持久化位置。第一版建议直接放进 session context 邻近区域，作为 session snapshot 的一部分持久化。

## 第一版边界

### v1 做什么

- 提供 session 级结构化 todo state
- 提供创建 / 更新 / 查询 todo 的内置工具
- 通过 todo tool result 和显式 `get_todo_list` 让模型消费当前 todo
- 保持 prompt 不再额外重复注入 todo 摘要
- 在 session 持久化与恢复后继续可用

### v1 不做什么

- 不做跨 session 的长期任务系统
- 不做独立数据库表或完整任务管理产品
- 不做提醒时间、cron、通知中心
- 不做多人协作、共享列表、指派人
- 不做“所有任务默认强制建 todo”
- 不做 UI 优先；第一版先让 runtime 行为和 trace 可验证

## 适用场景

第一版建议只在以下场景使用 todo：

- 用户请求明显是多步骤任务
- agent 已经进入跨多个工具的执行链路
- 当前任务有 3 步以上的可识别中间目标
- 用户明确要求“列个清单 / 分步骤做”

以下场景默认不建 todo：

- 单轮直接回答
- 单次工具调用即可完成的任务
- 纯闲聊或解释性问答
- 任务本身过短，维护 todo 反而增加噪音

## 数据模型

第一版建议新增以下结构：

```ts
export type TodoItemStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface SessionTodoItem {
  id: string;
  content: string;
  status: TodoItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTodoState {
  items: SessionTodoItem[];
  activeItemId: string | null;
  lastUpdatedAt: string | null;
}
```

建议落点：

- `packages/domain/src/session-context.ts`
- `packages/agent/src/session/shared.ts`
- `packages/agent/src/types.ts`
- `packages/agent/src/session/postgres-session-manager.ts`

### 状态约束

第一版固定以下规则：

- item 必须有稳定 `id`
- `content` 为用户可读短句，不存大段解释
- 同一时刻最多一个 `in_progress`
- `done` 和 `cancelled` 都视为 terminal status
- `activeItemId` 若非空，必须指向一个现存 item

### 为什么保留 `activeItemId`

不要让模型每轮自己从多个 item 中猜“当前正在做哪一个”。

显式 `activeItemId` 可以：

- 让模型消费 todo 时更短
- 让 UI 和 trace 更容易显示
- 避免出现两个 item 同时被标成 `in_progress`

## Tool Contract

第一版不采用下面这组接口：

- `create_todo_list`
- `add_items`
- `update_item_status`
- `delete_items`
- `mark_as_done`

原因是语义重复，尤其 `mark_as_done` 和 `update_item_status(status=done)` 重叠。

第一版建议收敛为 3 个工具。

### 1. `replace_todo_list`

用途：

- 新建 todo
- 在 agent 发现原 todo 明显不合适时整体重写

输入建议：

```ts
{
  items: Array<{
    content: string;
  }>;
  activeIndex?: number;
}
```

行为：

- 完整替换当前 session todo
- 自动生成 item id / createdAt / updatedAt
- 若传入 `activeIndex`，对应 item 设为 `in_progress`
- 其他 item 默认为 `pending`
- 默认成功返回紧凑 metadata：`ack / itemIds / activeItemId / hash`
- 如果后续需要完整 todo 内容，应显式调用 `get_todo_list`

约束：

- item 数量建议限制在 `1..8`
- 每项 `content` 不超过约 120 个字符

### 2. `update_todo_items`

用途：

- 更新 status
- 修改 item 文案
- 追加新项
- 删除已有项
- 切换 active item

输入建议：

```ts
{
  operations: Array<
    | {
        type: "set_status";
        id: string;
        status: "pending" | "in_progress" | "done" | "cancelled";
      }
    | { type: "set_content"; id: string; content: string }
    | { type: "append"; content: string }
    | { type: "remove"; id: string }
    | { type: "set_active"; id: string | null }
  >;
}
```

行为：

- 按顺序执行 operation
- 自动维护 `updatedAt`
- 若有 item 被设为 `in_progress`，其他 item 的 `in_progress` 自动清空
- 默认成功返回紧凑 metadata：`ack / itemIds / activeItemId / hash`
- 如果后续需要完整 todo 内容，应显式调用 `get_todo_list`

### 3. `get_todo_list`

用途：

- 读取当前 todo state
- 让模型在恢复执行或长链路中重新对齐

输出建议：

- 结构化返回 `items`、`activeItemId`、`lastUpdatedAt`
- 同时返回适合直接展示给用户的简短文本摘要
- 当 `replace_todo_list` / `update_todo_items` 只返回紧凑 ack metadata 时，`get_todo_list` 是重新拉取完整 todo state 的标准入口

### 为什么需要 `get_todo_list`

即使 todo 已持久化在 session，中间也可能发生：

- 上下文压缩
- 恢复执行
- 用户插入额外问题

显式读取工具比“赌模型记住了上次更新结果”更稳。

## Prompt 消费

### 当前边界

todo 真相源应保留在 session state，模型当前主要通过 todo tool result 和 `get_todo_list` 显式消费，而不是再额外拼一份 `runtimeContextMessages` 摘要。

仍然不适合承载 todo 明细的地方：

- `system`
- `prefixMessages`
- 额外的 `runtimeContextMessages` 重复摘要

原因：

- todo 会随着任务推进不断变化
- 同一份内容已经会通过 todo 工具结果进入 `messages`
- 额外摘要会和 tool result 回放形成双份上下文

## Runtime 行为约束

第一版建议加入以下高层约束：

1. 当存在 todo 且当前任务仍在推进时，agent 应优先围绕 active item 行动
2. 当某一步已经完成时，应尽快更新对应 status，而不是等到最后统一改
3. 当用户显著改变目标时，允许整体替换 todo
4. 当 todo 与用户最新要求冲突时，以用户最新要求为准

这类规则可以体现在：

- `system` 中的一条稳定高层指令
- 或 todo 工具结果 / `get_todo_list` 的读取链路中显式消费

但不应写成长篇流程说明。

## Trace 与可观测性

第一版至少要保证：

- tool trace 中能看见 todo 工具输入输出
- session snapshot 恢复后，todo 状态可复现
- `prompt` trace 中不会再看到额外重复的 todo runtime 摘要

可选增强：

- 新增独立 `todo_state_updated` trace event

如果第一版不单独建 event，也至少要保证从现有 trace 能回答：

- 这轮有没有 todo
- 当前 active item 是什么
- agent 是否在关键步骤后更新了 status

## Session 持久化

第一版建议把 todo state 放入现有 session snapshot 链路，而不是单开存储。

原因：

- todo 的生命周期天然跟 session 绑定
- 当时 repo 仍需要同步多套 session manager；当前主链路已经收敛为 `PostgresSessionManager`
- 复用 session snapshot 读写，比新增一张任务表更符合 v1 范围

需要同步更新：

- `packages/agent/src/session/shared.ts`
- `packages/agent/src/session/postgres-session-manager.ts`
- snapshot 校验逻辑

## 模块落点建议

### `packages/domain/src/`

- `session-context.ts`
  - 增加 `SessionTodoItem`
  - 增加 `SessionTodoState`
  - 在 `ScheduleSessionContext` 中挂入 `todoState`

### `packages/agent/src/tools/`

新增：

- `replace-todo-list.ts`
- `update-todo-items.ts`
- `get-todo-list.ts`

并在 `registry.ts` 中挂载到默认 runtime tool surface。

### `packages/agent/src/prompt.ts`

- 只保留稳定的 todo 使用高层约束
- 不再在 runtime context builder 中注入 todo 摘要
- 避免和现有 turn-budget 动态消息或 tool result 回放形成重复上下文

### `packages/agent/src/session/`

- 更新 snapshot create / clone / validate
- 更新 postgres 序列化与恢复

## 建议实现步骤

1. 先补 session todo 数据结构
2. 补 `get_todo_list`，先把读取链路跑通
3. 再补 `replace_todo_list`
4. 再补 `update_todo_items`
5. 最后补 prompt / trace 验证，确认没有额外重复注入

这样做的原因是：

- 先有真相源，再有写操作
- 先有显式读取，再让模型依赖 todo
- 最后再验证 prompt 边界，更容易看清重复注入有没有被清掉

## 验收标准

满足以下条件才算第一版成立：

1. agent 可以在一个多步任务中创建 todo，并把第一项设为 `in_progress`
2. agent 在完成某步后，能够只更新对应 item，而不是整表重建
3. 当 session 恢复执行时，`get_todo_list` 仍能读到之前状态
4. prompt trace 中不会再看到额外重复的 todo runtime 摘要
5. history compact 后，agent 仍能依赖 session todo state 对齐任务
6. 当用户改变目标时，agent 可以整体替换 todo，并以最新目标为准

## 测试建议

至少补以下测试：

- `prompt` 测试：有 todo / 无 todo 时都不应重复注入 `runtimeContextMessages`
- `session` 测试：snapshot create / clone / validate
- `postgres session manager` 测试：todo state 序列化与恢复
- `runtime` 测试：多步任务中创建、更新、读取 todo
- `compaction` 相关测试：历史被 compact 后仍可从 session state 恢复 todo

## 当前不建议做的两件事

### 1. 不要把 todo 当成“坚持任务”的 moral reminder

todo 的价值在于结构化状态，不在于反复提醒模型“别跑偏”。
如果模型已经拿到 active item 和 open items，额外重复说“stick on the task”收益有限。

### 2. 不要把 todo 变成重型任务系统

第一版只解决：

- 当前 session 内
- 多步任务可跟踪
- 状态可恢复
- prompt 可对齐

不要一上来做：

- 截止时间
- 优先级体系
- 子任务树
- 跨 session 同步
- 提醒通知

## 待确认问题

这份草案落代码前，还需要确认两件事：

1. todo 工具是否默认总是挂载，还是只在某个 setting / capability pack 开启时挂载

//总是挂载

2. `todoState` 是放进 `ScheduleSessionContext`，还是上提为更通用的 session context 字段

在当前 repo 形态下，我更倾向于：

- 默认挂载
- 先放进现有 session context

先跑通行为，再决定是否抽成更中性的命名和模块边界。
