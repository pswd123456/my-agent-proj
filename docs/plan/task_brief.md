# Task Brief

更新时间：2026-04-26
状态：设计中，未落地
范围：`planmode` / 未来 `full compaction` / `packages/agent` planning state

## 背景

当前 runtime 已经具备两类和长任务相关的显式状态：

1. `session.messages`
   - 保存完整会话事实流
   - 但历史过长时会进入 `history compact`

2. `session.context.todoState`
   - 保存步骤列表和 active item
   - 适合短任务推进
   - 不足以表达目标、验收标准、已验证事实和恢复锚点

这导致一个典型缺口：

- 长任务进入中后段后，`todoState` 只知道“接下来做哪一步”
- runtime 却没有一份短而稳定的任务骨架，来表达“任务到底要完成什么、哪些结论已经确认、为什么当前计划是这样”

这份文档的目标不是引入一个泛化的长期 `working memory`，而是定义一份更收敛的 `task brief`。

## 本次定位

`task brief` 是：

- `planmode` 的显式 planning state
- 未来 `full compaction` 的输入模板之一
- 当前 `todoState` 上面的一层“任务骨架”

`task brief` 不是：

- 通用长期记忆系统
- 自动学习层
- 普通多轮聊天默认常驻的大状态
- 替代 `session.messages` 的恢复事实源

一句话说，它更像“任务摘要骨架”，而不是“另一套 memory”。

## 为什么不直接做成通用 working memory

如果把它做成任何长任务都会维护的一份通用 memory，会有几个问题：

1. 状态过重
   - 普通任务不需要额外维护一套丰富的显式状态
   - 容易把 planning 负担扩散到所有执行场景

2. 与 `todoState` 重叠
   - 一部分步骤类信息会和 `todoState` 重复
   - 模型会在“更新 todo”还是“更新 memory”之间摇摆

3. 与 compaction 边界不清
   - 当前仓库已经明确：`history compact` 是默认机制
   - 新状态如果常驻注入上下文，会让 compact 设计再次膨胀

因此这里不做“通用 working memory”，只做 `planmode` 和 `full compaction` 都能消费的一份窄状态。

## 设计结论

### 1. 底层形态：结构化 session state

第一版把 `task brief` 挂到 `session.context`，与 `todoState` 同级。

建议字段：

```ts
type SessionTaskBrief = {
  goal: string | null;
  acceptanceCriteria: string[];
  constraints: string[];
  keyFacts: Array<{
    id: string;
    summary: string;
    evidence?: string;
  }>;
  decisions: Array<{
    id: string;
    summary: string;
    rationale?: string;
  }>;
  nextCheckpoint: string | null;
  lastUpdatedAt: string | null;
};
```

设计原则：

- 保持短、小、可压缩
- 只保留任务骨架，不保留大量过程文本
- 不复制完整 tool 输出
- 不承担最终恢复事实源职责

### 2. 使用边界：只在两类场景强使用

`task brief` 第一版只面向两类场景：

#### A. `planmode`

当 session 进入 `planmode` 时：

- 模型需要显式形成任务骨架
- `task brief` 应成为 planmode 的一部分，而不是额外外挂
- `todoState` 负责步骤推进，`task brief` 负责目标、验收、关键事实和阶段性决策

#### B. `full compaction`

当未来引入 `full compaction` 时：

- `task brief` 作为高价值输入模板的一部分
- 用来帮助生成 compact 后的 continuation brief
- 不直接替代 compact summary，但应为 summary 提供稳定骨架

### 3. 平时不常驻要求强维护

普通执行态不强制模型维护 `task brief`。

也就是说：

- 不因为“任务稍微复杂”就默认开启
- 不把它变成每轮都必须调用的 memo tool
- 不让它污染所有 session 的默认负担

## 与 todo 的分工

### `todoState`

负责：

- 当前任务分解
- active step
- 步骤状态流转

典型问题：

- 现在做哪一步
- 哪一步完成了
- 哪一步被取消了

### `task brief`

负责：

- 任务目标
- 验收标准
- 已确认事实
- 关键决策
- 下一次 checkpoint 的锚点

典型问题：

- 这次任务到底要交付什么
- 哪些前提已经被验证
- 为什么当前计划是合理的
- 中断后应该从什么认知状态继续

## 与 prompt / context 的关系

`task brief` 如果落地，不应进入 stable prefix。

应沿用当前 runtime context 分层思路：

- `system`：稳定规则
- `prefixMessages`：相对稳定的 session 前缀
- `messages`：会话历史
- `runtimeContextMessages`：本轮执行态

因此 `task brief` 的注入位置应与 `todoState` 同类，进入 `runtimeContextMessages`。

约束：

- 不进入 cache key
- 不写成大段自由文本
- 展示时优先短摘要

## Tool 设计方向

第一版不建议拆很多碎 tool。

建议先保留一个聚合型 tool：

```ts
update_task_brief
```

支持的操作可以包括：

- `set_goal`
- `set_acceptance_criteria`
- `set_constraints`
- `add_key_fact`
- `add_decision`
- `set_next_checkpoint`
- `clear_task_brief`

原因：

- 便于模型学习和使用
- 便于后续和 `planmode` 绑定
- 避免在 planning registry 里堆太多小工具

如果后续发现模型稳定性不足，再考虑拆分为 `replace_task_brief` / `append_task_brief_fact` 之类的更强约束 surface。

## planmode 集成方式

这份文档只定义 `task brief` 的角色，不把完整 `planmode` 设计在这里一次写完。

但本次先明确边界：

1. `planmode` 不是独立 runtime
   - 仍挂在现有 session / prompt / tool loop 上

2. `task brief` 不是 planmode 的全部
   - 它只是 planmode 的显式 planning state

3. `planmode` 后续还需要单独补全这些设计
   - 进入 / 退出条件
   - mutating tool gating
   - prompt 约束
   - UI 展示
   - plan 产物如何转入执行态

## full compaction 集成方式

这份文档同样不直接定义完整 `full compaction`。

这里只先确定 `task brief` 在其中的角色：

1. `full compaction` 不应只做机械摘要
   - 应保留任务主线、当前 frontier 和恢复锚点

2. `task brief` 可以提供 compact 模板的稳定字段
   - goal
   - acceptance criteria
   - constraints
   - key facts
   - decisions
   - next checkpoint

3. 后续仍需单独补全文档
   - full compaction 触发条件
   - 是否写回 session
   - compact 前后 trace 如何记录
   - compact 后如何恢复继续执行

## 第一版建议落地顺序

### Step 1. 定义状态与 schema

新增：

- `session.context.taskBrief`
- 对应 normalize / validate / persistence

### Step 2. 加入 planning tool surface

新增：

- `update_task_brief`

并把它放进 planning registry，而不是 workspace registry。

### Step 3. 只在 planmode 场景接入 prompt 约束

第一版不要对所有 session 都强制要求使用。

### Step 4. full compaction 设计单独成文

在 full compaction 文档里显式引用 `task brief`，把它作为 compact 模板输入之一，而不是在这里顺手定义 compact 算法。

## 非目标

这份设计第一版不做：

- 通用长期 working memory
- 自动抽取所有历史为 task brief
- 普通模式下强制每轮维护
- 取代 `todoState`
- 取代 `session.messages`
- 直接落完整 `planmode`
- 直接落完整 `full compaction`

## 需要后续继续补全的设计

当前文档只完成了一个中间层定义。后续仍然需要至少两份配套设计：

1. `planmode` 设计
   - 如何进入
   - 如何退出
   - 哪些工具受限
   - `task brief` 与 `todoState` 的强制关系

2. `full compaction` 设计
   - 触发阈值
   - compact 模板
   - `task brief` 如何参与
   - compact 后 continuation brief 如何生成和持久化

## 验收标准

这份规格后续如果开始实现，应满足：

1. `task brief` 被明确定位为 `planmode` 和 `full compaction` 共用任务骨架
2. 不把它写成通用长期 memory
3. 与 `todoState` 分工清楚
4. 注入位置保持在 `runtimeContextMessages`，不污染 cache key
5. 后续 `planmode` / `full compaction` 仍各自需要单独实现设计
