# 组件与 Patterns 策略

## 说明

根目录 `DESIGN.md` 已经覆盖组件语言的整体气质与禁止事项。

本页只保留组件体系如何拆层、何时新增、以及当前仓库特有 pattern 应该如何归位。

## 组件分层

建议至少分三层：

- 基础组件
- 组合组件
- 业务语义组件

示例：

- 基础组件：`Button`、`Input`、`Dialog`
- 组合组件：`PageHeader`、`FilterBar`、`StatBlock`
- 业务组件：`TaskStatusBadge`、`ConversationPanel`、`ReviewSummary`

## 准入原则

- 新页面先查现有组件
- 能通过现有组件组合解决，就不新增组件
- 能通过新增有限 variant 解决，就不新建平行组件
- 新组件最好能复用在至少两个页面或两个场景

## 容器嵌套原则

- 页面结构应尽量避免三层及以上 `box -> box -> box` 的容器嵌套
- 优先减少无意义的外框包裹，避免为了“分组”重复套卡片、面板、section 容器
- 如果业务上确实需要多层信息分组，内层容器应优先采用无边框设计
- 多层分组优先通过背景色块、留白、排版层级和标题语义区分，而不是继续叠加边框
- 只有最外层或当前交互焦点层保留明确边框，其余层级默认弱化线框存在感

## 高频 Patterns

建议优先沉淀的结构模式包括：

- 统计区
- 列表过滤区
- 详情侧栏
- 时间线区
- 对话区
- 空状态区

这些 patterns 应优先沉淀到 `packages/ui-patterns`，而不是散落在页面里。

## 新增工作台模式

### `SessionRail`

- 用于列出、创建、选择和恢复会话
- 单条信息优先展示 `loopState`、更新时间、最近一次用户输入
- 冲突确认或等待态应通过统一状态提示暴露，不要让用户点进详情后才发现

### `DebugInspector`

- 用于承载 `Prompt / Thinking / Tools / Trace` 等调试视图
- 默认使用 tab 切换，避免把大段 JSON 直接堆在主消息流
- `thinking` 文本使用 muted 语义层级，不与 assistant 正文争主次
- `tool` 视图至少显示 input、raw output 和 display text 三层信息

### `ConversationWorkbench`

- 这是 `ConversationPage` 的工作台骨架，而不是业务组件
- 只负责三栏外框、section header 和 inspector shell
- 具体业务区块，例如 session 列表、消息流、周历面板，仍应留在应用层实现

## 与 `DESIGN.md` 的关系

- `DESIGN.md` 负责说明这些 pattern 应呈现出的统一气质
- 本页负责限制这些 pattern 在代码结构里如何被复用和沉淀
