# 项目概览

## 当前定位

- 仓库主线是一个以 `TypeScript` + `Bun` 为主栈的通用个人助手 `agent runtime`
- 当前优先服务工作区理解、文件操作、权限等待、执行可观测性，以及 capability pack 扩展

## 当前运行主链路

- `apps/api` 是当前运行主入口，负责 session 生命周期、设置读取、runtime 装配、SSE 输出、trace 查询与恢复接口
- `apps/web` 是当前唯一产品层前端，主要承载 workbench、会话可视化、trace 与调试观察
- `apps/worker` 是后台执行入口，负责轮询 `background_tasks`、认领 detached task，并用独立 child session 驱动长任务
- `packages/agent` 提供 runtime loop、prompt、provider 适配、统一模型服务、permission checker、session manager、tool registry、skills、trace 与 system log
- `packages/db` 提供 PostgreSQL 访问、schema 初始化、settings repository、routine repository、background task repository
- `packages/domain` 提供 session settings、session context、权限规则和 routine 领域模型
- `packages/sdk` 提供给 Web 使用的 API client、摘要转换与跨层类型

## 当前默认行为

- session 默认工作目录是仓库根下的 `agent-workspace/`
- session 默认 `contextWindow` 是 `200000`
- session 默认 `maxTurns` 是 `50`，接口允许的上限是 `200`
- 默认启用的 capability packs 是 `workspace` 和 `schedule`
- session settings 的解析顺序是 `explicit override > user settings > repo default`
- detached background task 使用独立 child session，不与 parent session 共用消息历史
- 工作区 runtime 上下文还会按次读取 `session.workingDirectory/.agent/`
  - `.agent/skills/` 提供 skill metadata
  - `.agent/.config.toml` 提供 MCP server 配置
  - `.agent/plans/` 承载 session 级 task brief artifact
- 用户级 settings 已持久化到 `agent_settings`，当前包含：
  - `model`
  - `workingDirectory`
  - `yoloMode`
  - `contextWindow`
  - `maxTurns`
  - `shellAllowPatterns` / `shellDenyPatterns`
  - `toolAllowList` / `toolAskList` / `toolDenyList`
  - `enabledCapabilityPacks`

## API 现状

当前 API 不只是 session create/execute：

- `GET /health`
- `GET/POST /sessions`
- `GET/PATCH/DELETE /sessions/:sessionId`
- `POST /sessions/:sessionId/execute`
- `POST /sessions/:sessionId/execute/stream`
- `POST /sessions/:sessionId/interrupt`
- `POST /sessions/:sessionId/snapshot`
- `POST /sessions/:sessionId/recover`
- `GET /sessions/:sessionId/trace`
- `GET /system-logs`
- `GET/PATCH /users/:userId/settings`
- `GET /sessions/:sessionId/routines`
- `POST /sessions/:sessionId/routines/reset`

文档描述这些接口时，应优先以 `apps/api/src/app.ts` 当前实现为准。

## 后台任务现状

- 当前已落地 `BackgroundTaskManager` v1 基座
- 任务主记录保存在 `background_tasks`
- 每次执行尝试保存在 `background_task_runs`
- v1 只支持 `agent_session` 执行后端
- 当前没有公开 background task API，也没有 cron/subagent tool surface

## 当前事实源

- API 装配：`apps/api/src/index.ts`
- session 默认值：`packages/domain/src/session-settings.ts`
- tool surface：`packages/agent/src/tools/registry.ts`
- 工作区 `.agent/` 配置：`docs/architecture/workspace-agent-config.md`
- 数据表：`packages/db/src/schema.ts`

## 推荐阅读顺序

- 想先建立全局认知：读 `docs/architecture/diagram.md`
- 想判断主线与专项能力边界：读 `docs/architecture/capability-packs.md`
- 想确认目录职责和模块归属：读 `docs/architecture/workspace-structure.md`
- 想确认工作区 `.agent/skills/` 和 `.agent/.config.toml` 的边界：读 `docs/architecture/workspace-agent-config.md`
- 想确认 plan mode、task brief artifact 和只读 planning 边界：读 `docs/architecture/context-management/plan-mode.md`
- 想确认技术事实而不是计划：读 `docs/architecture/tech-stack.md`
