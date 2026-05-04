# 持久化与 Session 状态模型

## 定位

这一层回答三个问题：

1. 什么状态属于单租户默认配置，什么状态属于某个 session 的运行时快照
2. 哪些事实存在数据库里，哪些存在 TOML / runtime / trace
3. `packages/domain`、`packages/db`、`packages/agent/src/session`、`packages/agent/src/settings-config` 各自负责什么

它是模块设计层的抽象文档，不是迁移手册。数据库变更流程仍以根目录 `AGENTS.md` 的迁移工作流为准。

## 四层分工

### `packages/domain`

这一层定义稳定的数据语义与归一化规则，不负责数据库访问。

当前核心内容包括：

- `session-settings.ts`：session 默认值、capability pack 选项、`contextWindow` / `maxTurns` 归一化
- `settings-config.ts`：global/workspace 两层 settings merge 规则
- `session-context.ts`：session 运行态字段、待批准/待提问/后台通知/todo/full compaction 等上下文类型
- `permission-rules.ts`：shell/tool allow/ask/deny 规则与 settings 允许配置的工具集合
- `background-task.ts`：后台任务 kind/status/payload/taskState/result envelope
- `routine.ts`、`tool-result.ts`、`user-context-hooks.ts`

一句话概括：`domain` 决定“这些字段在业务上意味着什么”。

### `packages/db`

这一层定义数据库结构和 repository。

当前核心内容包括：

- `schema.ts`：Drizzle schema 与 `ensureProductSchema()`
- `routine-repository.ts`
- `cron-job-repository.ts`
- `background-task-repository.ts`
- `inbox-repository.ts`
- `client.ts`

一句话概括：`db` 决定“哪些业务事实需要落到 PostgreSQL”。

### `packages/agent/src/settings-config`

这一层负责单租户配置真相源：

- 全局配置：`~/.agents/config.toml`
- 工作区配置：`<workingDirectory>/.agents/.config.toml`
- 启动 seed：仅当全局配置不存在时，从旧 `agent_settings` 按默认 seed user 读一条记录写入全局 TOML

它对外暴露 `SettingsConfigStore`，供 API、runtime、cron dispatcher 和 gateway 统一读取或更新 settings。

一句话概括：`settings-config` 决定“默认配置从哪里来，以及 global/workspace 如何合并”。

### `packages/agent/src/session`

这一层把数据库记录和 runtime 快照连接起来。

当前核心内容包括：

- `contracts.ts`：`SessionManager` 抽象
- `postgres-session-manager.ts`：当前主链路实现
- `message-codec.ts`：消息块与数据库消息行之间的序列化 / 反序列化
- `session-row-mapper.ts`：session/checkpoint 行到 runtime snapshot 的映射
- `execution-lease.ts`：execution lease 的时间与状态判断
- `shared.ts`：snapshot 创建、克隆、归一化
- `task-brief.ts`、`todo-state.ts`

一句话概括：`session` 层决定“runtime 眼中的 session snapshot 如何被创建、恢复、更新、持久化”。

## 状态分桶

当前主链路里的状态可以分成七桶。

### 1. 单租户默认配置：global/workspace TOML

这类状态跨 session 复用，属于“以后新建 session 默认带什么”。

字段统一由 `SettingsConfigStore` 暴露，当前包括：

- `workingDirectory`
- `model`
- `thinkingEffort`
- `yoloMode`
- `contextWindow`
- `maxTurns`
- shell / tool 权限规则
- `enabledCapabilityPacks`
- `workspaceSkillSettings`
- `userContextHooks`
- `debugConversationView`
- `userCustomPrompt`
- `channels.*`
- `mcpServers.*`

其中：

- `~/.agents/config.toml` 保存全局默认值
- `<workingDirectory>/.agents/.config.toml` 只覆盖自己声明的字段
- 数组字段采用“声明即替换”
- legacy `[hooks.<id>]` 仍可写在 workspace `.agents/.config.toml` 中，并在最终 merge 时排在全局 hooks 前面统一归一化

数据库里已经没有 `agent_settings` 表；它只在首次 seed 全局 TOML 时作为一次性迁移来源。

### 2. Session 快照：`agent_sessions` + `session_messages`

这类状态是某个 session 的可恢复事实源。

`agent_sessions` 负责保存：

- 顶层身份：`workingDirectory`、`model`
- 运行态：`status`、`loopState`、`turnCount`、`lastError`
- 行为开关：`yoloMode`、`planModeEnabled`、`thinkingEffort`
- 权限态：shell / tool allow/ask/deny、`workspaceEscapeAllowed`
- prompt / compact 相关：`contextWindow`、`maxTurns`、`promptCacheKey`
- 等待态：`pendingPermissionRequest`、`pendingConfirmationPayload`、`pendingUserQuestionPayload`
- background / todo / compaction：`pendingBackgroundNotifications`、`activeBackgroundTaskCount`、`hookContextEntries`、`todoState`、`fullCompactionState`
- 观测辅助：`firstUserMessage`、`lastUserMessage`
- 执行 lease：`activeRunId`、`activeRunStartedAt`

`session_messages` 负责保存顺序化对话块：

- `user`
- `assistant`
- `assistant_thinking`
- `tool_call`
- `tool_result`

这里的设计重点是：session 恢复依赖数据库里的 snapshot + messages，而不是依赖 trace 回放。

### 3. Session 历史锚点：`session_fork_checkpoints`

这类状态描述“哪些 assistant 完成点可以作为 fork / rewrite 的恢复锚点”。

这张表保存：

- `assistantMessageId`
- `turnCount`
- `baseMessageCount`
- `snapshotJson`
- `promptSeedJson`

其中：

- `snapshotJson` 保存该 assistant 回合结束时的 session snapshot
- `promptSeedJson` 保存当时真正发给模型的 prompt seed，供 fork session 首轮 replay 使用
- `baseMessageCount` 用来定位触发这轮 assistant 的用户输入边界，而不是简单依赖消息尾部位置

与这张表配套，`agent_sessions` 还会保存：

- `parentSessionId`
- `parentRelationKind`
- `forkReplayCheckpointId`

它们表达 fork session 的父子关系，以及 fork session 下一轮是否要按 checkpoint replay 一次。

### 4. 后台任务：`background_tasks` + `background_task_runs`

这类状态描述“当前会话之外的执行”。

`background_tasks` 保存：

- `kind` / `status` / `executor`
- parent/child session 关系
- `payload`
- `taskState`
- 调度字段：`availableAt`、`deadlineAt`、`attemptCount`、`maxAttempts`
- claim/heartbeat/completion 字段

`background_task_runs` 保存一次具体执行尝试：

- `runId`
- `taskId`
- `status`
- `workerId`
- `errorSummary`
- `resultSummary`
- `startedAt` / `finishedAt` / `lastHeartbeatAt`

### 5. 领域专项数据：`routines`

这张表承载日程能力本身的业务数据，和 session 恢复、后台任务是并列关系，不应混进 session message 或 session context。

它已经是单租户表，不再用 `user_id` 做过滤维度。

### 6. 调度定义数据：`cron_jobs`

这张表承载“未来要不要自动发起一次 session”的调度定义，和 `background_tasks` 的关系是“定义 -> 触发实例”。

`cron_jobs` 主要保存：

- 调度模式与时间参数，例如 interval / weekday / timeOfDay
- 运行状态，例如 `active`、`paused`、`completed`
- prompt、工作目录、可选模型覆盖、可选 `thinkingEffort` 覆盖
- `runCount`、`maxRuns`、`lastRunAt`、`nextRunAt`、`lastError`

当前链路是：

1. API 通过 `/cron-jobs` 维护 `cron_jobs`
2. worker 用 `packages/agent/src/cron/dispatcher.ts` 扫描到期记录
3. dispatcher 通过 `settingsConfigStore.getEffectiveSettings(cronJob.workingDirectory)` 解析默认 settings
4. dispatcher 创建新的 `agent_sessions` 行，并写入一条 `background_tasks(kind=cron_job)` 记录

### 7. Inbox channel binding：`inbox_bindings`

这张表承载外部聊天入口到 session 的轻量绑定，目前只落地 Telegram 私聊 v1：

- `channel` / `externalChatId` 标识外部聊天来源
- `activeSessionId` 指向该聊天当前选中的 session
- `settings.responseOutputMode` 控制只输出 final answer 还是输出进度摘要
- `lastUpdateId` 用来忽略重复 Telegram update

它已经不再存 `userId`，也不再把 chat 映射成独立租户。

## 默认值是怎么流动的

默认值当前有清晰的流向：

1. `packages/domain/src/session-settings.ts` 定义 repo 级默认值
2. `SettingsConfigStore.getGlobalSettings()` 确保 `~/.agents/config.toml` 存在；首次缺失时才按默认 seed user 从旧 `agent_settings` 写入
3. `POST /sessions` 创建 session 时，按
   `explicit override > effective settings > repo default`
   解析本次初始值
4. `createSnapshot()` 生成 runtime 使用的 `SessionSnapshot`

这里的 `effective settings` 指：

- 先取全局 `~/.agents/config.toml`
- 再按当前 `workingDirectory` 读取 `<workingDirectory>/.agents/.config.toml`
- 字段级 merge 后得到本次 runtime / session 默认值

这意味着：

- 全局 settings 是“单租户默认值”
- workspace config 是“某个 working directory 下的局部覆盖”
- session 上下文是“这个 session 当前是什么状态”
- 三者不能混写成同一份数据库记录

## SessionManager 的角色

`SessionManager` 抽象不是单纯 CRUD，它还承担运行态一致性：

- 创建 session
- 恢复 session snapshot
- 追加消息块
- 更新 loop state / interrupt / active run lease
- 保存与裁剪 fork checkpoints
- 删除 session 子树

它不负责解析 TOML 默认配置，也不负责 MCP / channel / hooks 的 workspace 配置加载。

## 当前事实源

- settings merge：`packages/domain/src/settings-config.ts`
- settings store：`packages/agent/src/settings-config/store.ts`
- session 持久化：`packages/agent/src/session/postgres-session-manager.ts`
- 数据表：`packages/db/src/schema.ts`
- cron 调度：`packages/agent/src/cron/dispatcher.ts`
