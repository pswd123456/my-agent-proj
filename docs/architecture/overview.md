# 项目概览

## 当前定位

- 仓库主线是一个以 `TypeScript` + `Bun` 为主栈的通用个人助手 `agent runtime`
- 当前优先服务工作区理解、文件操作、权限等待、执行可观测性、后台任务执行，以及 capability pack 扩展

## 当前运行主链路

- `apps/api` 是当前运行主入口，负责 session 生命周期、设置读取、runtime 装配、SSE 输出、trace 查询与恢复接口
- `apps/web` 是当前唯一产品层前端，主要承载 workbench、会话可视化、trace 与调试观察
- `apps/worker` 是后台执行入口，负责轮询 `background_tasks`、认领 detached task，并用独立 child session 或 detached shell process 驱动长任务
- `packages/agent` 提供 runtime loop、prompt、provider 适配、统一模型服务、permission checker、session manager、tool registry、skills、MCP、background tasks orchestration、delegation、trace 与 system log
- `packages/db` 提供 PostgreSQL 访问、schema 初始化、settings repository、routine repository 与 background task repository
- `packages/domain` 提供 session settings、session context、权限规则、background task 载荷与 routine 领域模型
- `packages/sdk` 提供给 Web 使用的 API client、摘要转换与跨层类型
- `packages/ui-patterns`、`packages/ui` 和 `packages/tokens` 分别承载页面骨架、基础组件与设计 token

## 当前默认行为

- session 默认工作目录是仓库根下的 `agent-workspace/`；如果用户设置或新建 session 时显式指定了其他目录，也可以落在 repo 外
- session 默认 `contextWindow` 是 `200000`
- session 默认 `maxTurns` 是 `100`，接口允许的上限是 `200`
- 默认启用的 capability packs 是 `workspace`、`schedule` 和 `lsp`
- session settings 的解析顺序是 `explicit override > user settings > repo default`
- detached background task 使用独立 child session 或 shell worker 执行，不与 parent session 共用消息历史
- 工作区 runtime 上下文还会按次读取 `session.workingDirectory` 下的工作区输入：
  - `AGENTS.md` 提供工作区根指令，进入本轮 runtime context，不进入 cache key
  - `.agent/skills/` 提供 skill metadata
  - `.agent/.config.toml` 提供 MCP server 配置
  - `.agent/plans/` 承载 session 级 task brief artifact
  - 其中 `.agent/plans/` 是运行时产物与用户可编辑 artifact，其余是运行时输入
- 公开 web 搜索、抓取和结构化抽取通过工作区 Firecrawl MCP 接入，不属于内建 capability pack
- 用户级 settings 已持久化到 `agent_settings`，当前包含：
  - `model`
  - `thinkingEffort`
  - `workingDirectory`
  - `yoloMode`
  - `contextWindow`
  - `maxTurns`
  - `shellAllowPatterns` / `shellDenyPatterns`
  - `toolAllowList` / `toolAskList` / `toolDenyList`
  - `enabledCapabilityPacks`
  - `userContextHooks`
  - `debugConversationView`
  - `userCustomPrompt`

当前权限语义里，`yoloMode` 会自动放行除 `run_shell_command` / `make_http_request` 之外的所有工具；shell / network 不走用户级 tool allow/ask/deny 配置，仍然在运行时单独审批。

## API 现状

当前 API 不只是 session create/execute：

- `GET /health`
- `GET /`
- `GET /models`
- `GET/POST /sessions`
- `GET /sessions/search`
- `DELETE /sessions/history`
- `GET/PATCH/DELETE /sessions/:sessionId`
- `GET /sessions/:sessionId/fork-targets`
- `POST /sessions/:sessionId/forks`
- `PATCH /sessions/:sessionId/settings`
- `GET /sessions/:sessionId/workspace-files/search`
- `GET /sessions/:sessionId/skills/search`
- `GET /sessions/:sessionId/git-status`
- `POST /sessions/:sessionId/execute`
- `POST /sessions/:sessionId/execute/stream`
- `POST /sessions/:sessionId/interrupt`
- `POST /sessions/:sessionId/force-stop`
- `POST /sessions/:sessionId/file-changes`
- `POST /sessions/:sessionId/snapshot`
- `POST /sessions/:sessionId/recover`
- `GET /sessions/:sessionId/trace`
- `GET /system-logs`
- `POST /directory-picker`
- `GET/PATCH /users/:userId/settings`
- `GET/PUT /users/:userId/settings/mcp`
- `GET /users/:userId/settings/skills`
- `GET /sessions/:sessionId/routines`
- `POST /sessions/:sessionId/routines/reset`

文档描述这些接口时，应优先以 `apps/api/src/app.ts` 当前实现为准。

## 后台任务现状

- 当前已落地 `BackgroundTaskManager` v1 基座
- 任务主记录保存在 `background_tasks`
- 每次执行尝试保存在 `background_task_runs`
- 当前支持 `agent_session` 与 `shell_command` 两类执行后端
- 领域模型里还保留 `cron_job` 这个 task kind，但当前 API / worker 主链路真正会创建和处理的是 `subagent`、`hook_subagent`、`shell_command` 与 `session_wakeup`
- `apps/worker` 负责轮询和执行这些任务，`packages/agent/src/background-tasks/` 负责通用 orchestration，`packages/agent/src/delegation/` 负责主 agent 发起与回复 delegated subagent
- 当前没有公开 background task API，也没有 cron tool surface；`subagent` 是内部任务类型，不是对外 HTTP 接口

## 当前事实源

- API 装配：`apps/api/src/index.ts`
- worker 装配：`apps/worker/src/index.ts`
- 模型目录与默认模型：`packages/agent/src/models/service.ts`
- session 默认值：`packages/domain/src/session-settings.ts`
- tool surface：`packages/agent/src/tools/registry.ts`
- tool 编排：`packages/agent/src/runtime/run-loop.ts`、`packages/agent/src/runtime/tool-execution.ts`
- background task：`packages/agent/src/background-tasks/`
- delegation：`packages/agent/src/delegation/`
- API 路由：`apps/api/src/app.ts`
- Web SDK：`packages/sdk/src/client.ts`
- 工作区 `.agent/` 配置：`docs/architecture/workspace-agent-config.md`
- workspace instructions：`packages/agent/src/workspace-instructions/`
- 数据表：`packages/db/src/schema.ts`

## 推荐阅读顺序

- 想先建立全局认知：读 `docs/architecture/diagram.md`
- 想判断主线与专项能力边界：读 `docs/architecture/capability-packs.md`
- 想确认 API 契约、runtime 装配与 SDK 侧 transport 边界：读 `docs/architecture/api-and-sdk-boundary.md`
- 想确认工具调用、权限等待、工具结果持久化和并发执行边界：读 `docs/architecture/tool-orchestration.md`
- 想确认后台任务、子代理和 worker 链路：读 `docs/architecture/background-tasks-and-delegation.md`
- 想确认 session/settings/background task 的持久化归属：读 `docs/architecture/persistence-and-session-state.md`
- 想从产品层理解 `apps/web` 和 shared UI 层怎么协作：读 `docs/architecture/frontend-workbench.md`
- 想确认目录职责和模块归属：读 `docs/architecture/workspace-structure.md`
- 想确认工作区 `.agent/skills/` 和 `.agent/.config.toml` 的边界：读 `docs/architecture/workspace-agent-config.md`
- 想确认 plan mode、task brief artifact 和只读 planning 边界：读 `docs/architecture/context-management/plan-mode.md`
- 想确认技术事实而不是计划：读 `docs/architecture/tech-stack.md`
