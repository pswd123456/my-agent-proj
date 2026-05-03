# 持久化与 Session 状态模型

## 定位

这一层回答三个问题：

1. 什么状态属于用户默认值，什么状态属于某个 session 的运行时快照
2. 哪些事实存在数据库里，哪些只存在 runtime / trace
3. `packages/domain`、`packages/db`、`packages/agent/src/session` 三层各自负责什么

它是模块设计层的抽象文档，不是迁移手册。数据库变更流程仍以根目录 `AGENTS.md` 的迁移工作流为准。

## 三层分工

### `packages/domain`

这一层定义稳定的数据语义与归一化规则，不负责数据库访问。

当前核心内容包括：

- `session-settings.ts`：session 默认值、capability pack 选项、`contextWindow` / `maxTurns` 归一化
- `session-context.ts`：session 运行态字段、待批准/待提问/后台通知/todo/full compaction 等上下文类型
- `permission-rules.ts`：shell/tool allow/ask/deny 规则与 settings 允许配置的工具集合
- `background-task.ts`：后台任务 kind/status/payload/taskState/result envelope
- `routine.ts`、`tool-result.ts`、`user-context-hooks.ts`

一句话概括：`domain` 决定“这些字段在业务上意味着什么”。

### `packages/db`

这一层定义数据库结构和 repository。

当前核心内容包括：

- `schema.ts`：Drizzle schema 与 `ensureProductSchema()`
- `settings-repository.ts`
- `routine-repository.ts`
- `background-task-repository.ts`
- `client.ts`

一句话概括：`db` 决定“这些语义如何落到 PostgreSQL 里”。

### `packages/agent/src/session`

这一层把数据库记录和 runtime 快照连接起来。

当前核心内容包括：

- `contracts.ts`：`SessionManager` 抽象
- `postgres-session-manager.ts`：当前主链路实现
- `shared.ts`：snapshot 创建、克隆、归一化
- `task-brief.ts`、`todo-state.ts`

一句话概括：`session` 层决定“runtime 眼中的 session snapshot 如何被创建、恢复、更新、持久化”。

## 状态分桶

当前主链路里的状态可以分成六桶。

### 1. 用户级默认值：`agent_settings`

这类状态跨 session 复用，属于“以后新建 session 默认带什么”：

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

这部分通过 `SettingsRepository` 暴露给 API 与 runtime。

### 2. Session 快照：`agent_sessions` + `session_messages`

这类状态是某个 session 的可恢复事实源。

`agent_sessions` 负责保存：

- 顶层身份：`userId`、`workingDirectory`、`model`
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

rewrite recovery 会直接裁掉目标 turn 及之后的 checkpoint，并同步裁掉更晚的 trace 记录；fork 则会从 checkpoint snapshot 复制出新的 session。

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

这让“任务主记录”和“每次 worker 尝试”分开建模。

`hook_subagent` 的持久化边界另外有两条补充事实：

- 任务运行中的结果通知先落在 `pendingBackgroundNotifications`
- 只有完成态、且配置哈希仍匹配当前 enabled hook 的结果，才会在下一次 run 前物化进 `agent_sessions.hook_context_entries`

因此 `hook_context_entries` 表示“当前 session 仍应注入给模型的已物化 hook 结果”，而不是所有 hook 执行历史的归档表。

### 5. 领域专项数据：`routines`

这张表承载日程能力本身的业务数据，和 session 恢复、后台任务是并列关系，不应混进 session message 或 session context。

### 6. 调度定义数据：`cron_jobs`

这张表承载“未来要不要自动发起一次 session”的调度定义，和 `background_tasks` 的关系是“定义 -> 触发实例”，不是同一层抽象。

`cron_jobs` 主要保存：

- 调度模式与时间参数，例如 interval / weekday / timeOfDay
- 运行状态，例如 `active`、`paused`、`completed`
- prompt、工作目录、可选模型覆盖、可选 `thinkingEffort` 覆盖
- `runCount`、`maxRuns`、`lastRunAt`、`nextRunAt`、`lastError`

当前链路是：

1. API 通过 `/users/:userId/cron-jobs` 维护 `cron_jobs`
2. worker 用 `packages/agent/src/cron/dispatcher.ts` 扫描到期记录
3. dispatcher 创建新的 `agent_sessions` 行，并写入一条 `background_tasks(kind=cron_job)` 记录
4. 后续执行再回到通用 background task runner

## 默认值是怎么流动的

默认值当前有清晰的流向：

1. `packages/domain/src/session-settings.ts` 定义 repo 级默认值
2. `SettingsRepository.getOrCreate()` 以这些默认值初始化 `agent_settings`
3. `POST /sessions` 创建 session 时，按
   `explicit override > user settings > repo default`
   解析本次初始值
4. `createSnapshot()` 生成 runtime 使用的 `SessionSnapshot`

这意味着：

- 用户设置是“未来新 session 默认带什么”
- session 上下文是“这个 session 当前是什么状态”
- 两者不能混写成一份表，也不该互相偷偷覆盖

## SessionManager 的角色

`SessionManager` 抽象不是单纯 CRUD，它还承担运行态一致性：

- 创建 session
- 读取 / 列表 / 删除 / recover
- 追加 conversation block
- 更新 `loopState`、`turnCount`、`promptCacheKey`、`lastError`
- patch session context
- 申请 / 释放 execution lease
- 中断正在运行的 session

当前仓库只保留 `PostgresSessionManager` 这一条 session 持久化实现。测试与 smoke 也通过 PostgreSQL 夹具运行，避免新增 session 字段或执行锁语义时出现多套实现漂移。

## 设计边界

### 该放在 `domain` 的

- 业务字段语义
- 默认值
- 归一化规则
- 纯类型与 helper

### 该放在 `db` 的

- 表结构
- repository
- SQL/Drizzle 持久化细节
- migration 入口

### 该放在 `agent/src/session` 的

- `SessionSnapshot` 与数据库行的映射
- 对话块序列化 / 反序列化
- execution lease
- fork checkpoint 的保存 / 查询 / 裁剪
- runtime 写回 session 的操作

### 不该发生的混层

- 在 `domain` 里写数据库访问
- 在 `db` 里发明新业务语义
- 让 Web 直接依赖表字段而绕过 session/api/sdk
- 把 trace 当成 session 恢复事实源

## 当前高价值事实源

- 领域类型：`packages/domain/src/`
- 数据表：`packages/db/src/schema.ts`
- cron job 持久化：`packages/db/src/cron-job-repository.ts`
- settings 持久化：`packages/db/src/settings-repository.ts`
- background task 持久化：`packages/db/src/background-task-repository.ts`
- session 抽象：`packages/agent/src/session/contracts.ts`
- Postgres session manager：`packages/agent/src/session/postgres-session-manager.ts`
- snapshot helper：`packages/agent/src/session/shared.ts`
- fork / rewrite helper：`packages/agent/src/session/checkpoint.ts`
