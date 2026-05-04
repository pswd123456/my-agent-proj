# 前端 Workbench 架构

## 定位

`apps/web` 当前不是多页面产品壳，而是一个以会话工作台为中心的单入口前端：

- 会话 rail
- 对话主区
- settings / hooks / calendar / inspector 侧栏
- trace / prompt / tools / thinking 可视化

它的核心目标不是“渲染一个聊天页面”，而是把 session、trace、streaming、workspace file changes、后台通知这些运行态事实，整理成稳定可操作的调试工作台。

## 模块分层

### 1. 路由与页面壳

关键文件：

- `apps/web/app/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/globals.css`

这里保持很薄：页面入口基本只挂载 `SessionWorkbench`。

### 2. 工作台容器

关键文件：

- `apps/web/app/_components/session-workbench.tsx`

这是前端主编排层，负责：

- 首次 bootstrap
- session 列表与当前 session hydrate
- 发起流式执行
- 轮询 session 列表 / 当前 session
- hydrate forkTargets / rewriteTarget 并把历史操作映射回对话区
- 拉 trace、routines、global settings、model catalog
- 组合多个本地 state slice

它知道“页面如何工作”，但不直接承担所有细节状态转换。

### 3. 本地状态切片

`apps/web` 目前把高频变化状态拆成多个 manager，而不是塞进一个巨型 reducer。

关键模块：

- `session-registry-manager.ts`：session 列表、当前选中 session、摘要合并
- `session-state-manager.ts`：当前 session 的 optimistic UI、提交态、中断态、stream event 写回
- `session-message-manager.ts`：把 `session.messages + trace + live stream overlay`、pending user message、动画 key 和折叠状态收口成前端消息投影
- `session-todo-state.ts`：todo tool result 驱动的 UI 状态

这几个切片分别回答不同问题：

- 哪些 session 在左侧 rail 里出现
- 当前 session 正在发生什么
- 对话区应该怎么把历史、流式、pending user、折叠流、inspector 事件和动画 key 拼起来

### 4. 展示组件层

关键文件：

- `session-workbench-ui.tsx`
- `session-workbench-conversation.tsx`
- `session-workbench-rail.ts`
- `session-workbench-drawer.tsx`
- `session-workbench-inspector.tsx`
- `session-conversation-view.ts`
- `session-timeline.ts`

这一层的职责是把上面各个 manager 产出的 view model 渲染出来，不反向定义 session 语义。

## 共享包的角色

### `packages/sdk`

前端不直接自己拼 API 调用，而是统一走 SDK：

- `createApiClient()`
- `listSessions()` / `getSession()` / `createSession()`
- `searchSessions()` / `listSessionForkTargets()` / `createSessionFork()`
- `recoverRewriteTarget()`
- `streamSessionExecution()`
- `interruptSessionExecution()`
- `chooseDirectory()`
- `getUserSettingsMcp()` / `updateUserSettingsMcp()` / `getUserSettingsSkills()`
- `getSessionWorkspaceGitStatus()`
- `getSessionTrace()`
- `toSessionSummary()`

这样前端组件不需要自己处理：

- fetch 错误解包
- SSE 解析
- cache-busting
- session summary 投影

### `packages/ui-patterns`

这一层提供页面布局骨架和 panel pattern。

当前已落地的主要是：

- `WorkbenchPanel`：当前已被 workbench drawer 直接复用
- `PageFrame`：当前用于 `/tokens` 这类文档型页面
- `ConversationWorkbench`：已作为共享骨架导出，但当前主 workbench 页面仍以 `apps/web/app/_components/session-workbench*.tsx` 的 repo 内编排为主

它负责稳定页面框架，但不负责 session 业务。

### `packages/ui`

放更细粒度的基础组件。当前规模还小，但边界已经明确：如果某个组件脱离 workbench 语义仍可复用，应优先下沉到这里。

### `packages/tokens`

这是运行时设计 token 的真相源。视觉数值、语义色、radius、surface 等应从这里往 Web 侧映射，而不是散落在页面局部。

## 当前主流程

### 1. 启动阶段

`SessionWorkbench` 首次挂载后会：

1. 拉 `listModels()`
2. 拉 `listSessions()`
3. 如果没有 session，则自动 `createSession()`
4. 根据 URL 或列表首项选择当前 session

### 2. 选中某个 session 后

会并行拉取：

- `getSession()`
- `listSessionForkTargets()`
- `getSessionTrace()`
- `listSessionRoutines()`
- `getUserSettingsPayload()`

然后分别更新：

- `sessionUiState`
- `forkTargets` / `rewriteTarget`
- `traceRecords`
- `routines`
- `userSettings`
- `settingsForm`
- `sessionRegistry`

### 3. 发起一次执行

当用户提交消息时，前端会：

1. 先进入 optimistic submitting 状态
2. 通过 SDK 调 `streamSessionExecution()`
3. 将 SSE `RunStreamEvent` 逐个写入：
   - `run-view-state`
   - `session-state`
   - `message-manager`
4. 在 `run_complete` / `run_error` 后收束本轮 UI

### 4. 文件变更视图

前端会从 tool result 中提取 `workspace_file_changes`，把一次 run 里的改动整理成可选择、可 `undo` / `reapply` 的视图；真正的文件变更动作还是通过 API 的 `POST /sessions/:sessionId/file-changes` 执行。

### 5. 历史 fork / rewrite 交互

对话区不是自己推断哪些历史节点可 fork 或可 rewrite，而是直接消费 API 返回的历史目标：

- assistant block 旁的 fork 动作来自 `forkTargets`
- user block 的 rewrite 动作只会绑定到当前 `rewriteTarget`

用户提交 rewrite 时，前端会先调 `recoverRewriteTarget()` 回退 session，再把编辑后的文本当作一次新的普通消息重新提交。也就是说，前端只负责编排交互，不定义 rewind 语义本身。

## 为什么要把消息编排单独收口

这个 workbench 的难点不是“把消息数组渲染出来”，而是同时处理：

- `session.messages`
- trace records
- 当前 run 的 streaming overlay
- thinking / assistant_text 增量动画
- compact / collapsed flow
- inspector 视图需要的额外结构

所以前端消息层现在专门有一个 message manager，并且已有单独文档：

- [前端 Message Manager](./context-management/frontend-message-manager.md)

Workbench 总体架构文档只描述它在系统里的位置，不重复 message manager 的细节实现。

如果问题表现为“切换 session 后折叠块先出现、随后又消失”，优先看：

- [前端 Message Manager](./context-management/frontend-message-manager.md)
- [折叠消息块 Hydration 回归](./context-management/collapsed-flow-hydration.md)

## 设计边界

### 适合留在 `apps/web` 的

- 页面级状态编排
- session workbench 交互
- 视图级 optimistic state
- route/query param 同步

### 适合下沉到共享包的

- 脱离 session 业务仍通用的基础组件
- 稳定的页面骨架 / panel pattern
- 运行时设计 token
- 类型化 API client

### 当前不该做的事

- 在页面组件里直接发裸 fetch，绕过 SDK
- 让 UI 直接依赖数据库表结构
- 把 runtime 事件顺序定义反向塞进展示组件
- 在单个渲染组件里同时维护 session 列表、流式执行、消息投影和 inspector 逻辑

## 推荐阅读

- 想看 transport 与 payload：读 [API 与 SDK 边界](./api-and-sdk-boundary.md)
- 想看消息投影：读 [前端 Message Manager](./context-management/frontend-message-manager.md)
- 想看 shared UI 约束：读 `docs/design-system/`
- 想看运行时主链路：读 [项目概览](./overview.md)

## 当前事实源

- 工作台容器：`apps/web/app/_components/session-workbench.tsx`
- session 列表状态：`apps/web/app/_components/session-registry-manager.ts`
- 当前 session UI 状态：`apps/web/app/_components/session-state-manager.ts`
- 消息投影与 run 临时视图状态：`apps/web/app/_components/session-message-manager.ts`
- 展示组件：`apps/web/app/_components/session-workbench-*.tsx`
- SDK：`packages/sdk/src/client.ts`
- 布局 patterns：`packages/ui-patterns/src/`
- 设计 tokens：`packages/tokens/src/index.ts`
