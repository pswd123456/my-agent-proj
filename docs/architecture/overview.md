# 项目概览

## 当前定位

- 仓库主线是一个以 `TypeScript` + `Bun` 为主栈的通用个人助手 `agent runtime`
- 当前优先服务工作区理解、文件操作、权限等待、执行可观测性、后台任务执行，以及 capability pack 扩展

## 当前运行主链路

- `apps/api` 是当前运行主入口，负责 session 生命周期、设置读取、SSE 输出、trace 查询与恢复接口，并通过共享 runtime assembly 装配执行依赖
- `apps/web` 是当前唯一产品层前端，主要承载 workbench、会话可视化、trace 与调试观察
- `apps/worker` 是后台执行入口，负责轮询 `background_tasks`、认领 detached task，并用独立 child session 或 detached shell process 驱动长任务
- `apps/gateway` 是常驻外部接入入口，当前负责 Telegram polling，并把 update 转交 API webhook
- `packages/agent` 提供 runtime loop、prompt、provider 适配、统一模型服务、permission checker、session manager、runtime assembly、tool registry、skills、MCP、background tasks orchestration、delegation、trace 与 system log
- `packages/db` 提供 PostgreSQL 访问、schema 初始化、routine repository、cron repository、inbox repository 与 background task repository
- `packages/domain` 提供 session settings、session context、权限规则、background task 载荷与 routine 领域模型
- `packages/sdk` 提供给 Web 使用的 API client、摘要转换与跨层类型
- `packages/ui-patterns`、`packages/ui` 和 `packages/tokens` 分别承载页面骨架、基础组件与设计 token

## 当前默认行为

- session 默认工作目录是仓库根下的 `agent-workspace/`；如果用户设置或新建 session 时显式指定了其他目录，也可以落在 repo 外
- session 默认 `contextWindow` 是 `200000`
- session 默认 `maxTurns` 是 `100`，接口允许的上限是 `200`
- 默认启用的 capability packs 是 `workspace`、`schedule` 和 `lsp`
- session settings 的解析顺序是 `explicit override > effective settings > repo default`
- detached background task 使用独立 child session 或 shell worker 执行，不与 parent session 共用消息历史
- 工作区 runtime 上下文还会按次读取 `session.workingDirectory` 下的工作区输入：
  - `AGENTS.md` 提供工作区根指令，进入本轮 runtime context，不进入 cache key
  - `.agents/skills/` 提供 skill metadata
  - `.agents/.config.toml` 提供 workspace 级 settings 覆盖、MCP server 配置、channels 和 legacy hook section
  - `.agents/plans/` 承载 session 级 task brief artifact
  - 其中 `.agents/plans/` 是运行时产物与用户可编辑 artifact，其余是运行时输入
- 公开 web 搜索、抓取和结构化抽取通过工作区 Firecrawl MCP 接入，不属于内建 capability pack
- 单租户默认 settings 的真相源是两层 TOML：
  - 全局：`~/.agents/config.toml`
  - 工作区：`<workingDirectory>/.agents/.config.toml`
  - merge 规则：workspace 只覆盖自己声明的字段，数组字段按“声明即替换”
- 当前统一 settings 字段包括：
  - `model`
  - `thinkingEffort`
  - `workingDirectory`
  - `yoloMode`
  - `contextWindow`
  - `maxTurns`
  - `shellAllowPatterns` / `shellDenyPatterns`
  - `toolAllowList` / `toolAskList` / `toolDenyList`
  - `enabledCapabilityPacks`
  - `workspaceSkillSettings`
  - `userContextHooks`
  - `debugConversationView`
  - `userCustomPrompt`

legacy workspace hooks 仍可写在 `.agents/.config.toml` 的 `[hooks.<id>]` section；runtime 创建时它们会先并入统一 settings，再排在全局 hooks 前面统一归一化。

当前权限语义里，`yoloMode` 会自动放行除 `run_shell_command` / `make_http_request` 之外的所有工具；shell / network 不走用户级 tool allow/ask/deny 配置，仍然在运行时单独审批。

当前还落地了 Telegram inbox adapter v1。它通过 `inbox_bindings` 维护私聊 chat 到 active session 的绑定，默认用 polling 接收 Bot API update，只处理文本私聊和 slash command；当 active session 正在 running 时，新普通消息会被报错并丢弃，不进入队列。

## API 现状

当前 API 不只是 session create/execute：

- `GET /health`
- `GET /`
- `GET /models`
- `GET/PUT /settings/channels`
- `GET /inbox/telegram/status`
- `POST /inbox/telegram/set-webhook`
- `POST /inbox/telegram/webhook`
- `GET/POST /sessions`
- `GET /sessions/search`
- `GET/POST/PATCH/DELETE /cron-jobs`
- `DELETE /sessions/history`
- `GET/PATCH/DELETE /sessions/:sessionId`
- `GET /sessions/:sessionId/fork-targets`
- `POST /sessions/:sessionId/forks`
- `POST /sessions/:sessionId/rewrite-target/recover`
- `PATCH /sessions/:sessionId/settings`
- `GET /sessions/:sessionId/workspace-files/search`
- `GET /sessions/:sessionId/skills/search`
- `GET /sessions/:sessionId/git-status`
- `POST /sessions/:sessionId/execute`
- `POST /sessions/:sessionId/execute/stream`
- `POST /sessions/:sessionId/interrupt`（默认中断入口，包含状态修复与当前 run 取消）
- `POST /sessions/:sessionId/force-stop`（兼容入口）
- `POST /sessions/:sessionId/file-changes`
- `POST /sessions/:sessionId/snapshot`
- `POST /sessions/:sessionId/recover`
- `GET /sessions/:sessionId/trace`
- `GET /system-logs`
- `POST /directory-picker`
- `GET/PATCH /settings`
- `GET/PUT /settings/mcp`
- `GET /settings/skills`
- `GET /sessions/:sessionId/routines`
- `POST /sessions/:sessionId/routines/reset`

文档描述这些接口时，应优先以 `apps/api/src/app.ts` 及其注册的 `apps/api/src/*-routes.ts` 当前实现为准。

## 后台任务现状

- 当前已落地 `BackgroundTaskManager` v1 基座
- 任务主记录保存在 `background_tasks`
- 每次执行尝试保存在 `background_task_runs`
- 当前支持 `agent_session` 与 `shell_command` 两类执行后端
- 当前后台任务 kind 包括 `cron_job`、`subagent`、`hook_subagent`、`shell_command` 与 `session_wakeup`
- `apps/worker` 负责先 dispatch 到期 cron job，再轮询和执行 queued background task；`packages/agent/src/background-tasks/` 负责通用 orchestration，`packages/agent/src/delegation/` 负责主 agent 发起与回复 delegated subagent，`packages/agent/src/cron/dispatcher.ts` 负责把 cron 定义转成 session 与 task
- 当前没有公开“通用 background task API”；`subagent` 仍是内部任务类型，但 cron job 已通过 `/cron-jobs` 暴露管理接口

## 当前事实源

- runtime 装配：`packages/agent/src/runtime/assembly.ts`
- API 进程入口：`apps/api/src/index.ts`
- worker 进程入口：`apps/worker/src/index.ts`
- gateway 进程入口：`apps/gateway/src/index.ts`
- 模型目录与默认模型：`packages/agent/src/models/service.ts`
- session 默认值：`packages/domain/src/session-settings.ts`
- tool surface：`packages/agent/src/tools/registry.ts`
- tool 编排：`packages/agent/src/runtime/run-loop.ts`、`packages/agent/src/runtime/tool-execution.ts`
- background task：`packages/agent/src/background-tasks/`
- cron dispatch：`packages/agent/src/cron/dispatcher.ts`
- delegation：`packages/agent/src/delegation/`
- API 路由：`apps/api/src/app.ts`、`apps/api/src/*-routes.ts`
- Web SDK：`packages/sdk/src/client.ts`
- 工作区 `.agents/` 配置：`docs/architecture/workspace-agent-config.md`
- workspace instructions：`packages/agent/src/workspace-instructions/`
- 数据表：`packages/db/src/schema.ts`
- Telegram inbox adapter：`apps/api/src/app.ts`、`apps/gateway/src/index.ts`、`packages/agent/src/channels/telegram.ts`、`packages/db/src/inbox-repository.ts`

## 推荐阅读顺序

- 想先建立全局认知：读 `docs/architecture/diagram.md`
- 想判断主线与专项能力边界：读 `docs/architecture/capability-packs.md`
- 想确认 API 契约、runtime 装配与 SDK 侧 transport 边界：读 `docs/architecture/api-and-sdk-boundary.md`
- 想确认 fork / rewrite 的 checkpoint、replay 和 rewind 边界：读 `docs/architecture/session-fork-and-rewrite.md`
- 想确认工具调用、权限等待、工具结果持久化和并发执行边界：读 `docs/architecture/tool-orchestration.md`
- 想确认后台任务、子代理和 worker 链路：读 `docs/architecture/background-tasks-and-delegation.md`
- 想确认 session/settings/background task 的持久化归属：读 `docs/architecture/persistence-and-session-state.md`
- 想从产品层理解 `apps/web` 和 shared UI 层怎么协作：读 `docs/architecture/frontend-workbench.md`
- 想确认目录职责和模块归属：读 `docs/architecture/workspace-structure.md`
- 想确认工作区 `.agents/skills/` 和 `.agents/.config.toml` 的边界：读 `docs/architecture/workspace-agent-config.md`
- 想确认 plan mode、task brief artifact 和只读 planning 边界：读 `docs/architecture/context-management/plan-mode.md`
- 想确认技术事实而不是计划：读 `docs/architecture/tech-stack.md`
