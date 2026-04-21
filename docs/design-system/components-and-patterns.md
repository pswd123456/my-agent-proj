# 组件与 Patterns 策略

## 目标

- 统一局部交互模式与视觉骨架
- 提高跨页面复用率
- 限制 AI 在页面中自由拼装的空间

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

## 禁止事项

- 页面复制现有组件样式后改出一个分叉版本
- 页面直接依赖大量底层 primitives 拼完整业务块
- 为单一页面需求无限扩展组件 props

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
