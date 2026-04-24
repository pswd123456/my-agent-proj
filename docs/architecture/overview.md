# 项目概览

## 当前定位

- 仓库主线是一个以 `TypeScript` + `Bun` 为主栈的通用个人助手 `agent runtime`
- 当前优先服务工作区理解、文件操作、执行可观测性，以及后续 capability pack 扩展
- `日程管理` 是已经落地的第一个 capability pack，不再代表整个仓库的默认产品身份

## 当前运行主链路

- `apps/api` 是当前运行主入口，负责 session 生命周期、设置读取、runtime 装配、SSE 输出、trace 查询与恢复接口
- `apps/web` 是当前唯一产品层前端，主要承载 workbench、会话可视化、trace 与调试观察
- `packages/agent` 提供 runtime loop、prompt、provider 适配、session manager、tool registry、skills、trace 与 system log
- `packages/db` 提供 PostgreSQL 访问、schema 初始化、settings repository、routine repository
- `packages/domain` 提供 session settings、session context、权限规则和 routine 领域模型
- `packages/sdk` 提供给 Web 使用的 API client、摘要转换与跨层类型

## 当前默认行为

- session 默认工作目录是仓库根下的 `agent-workspace/`
- session 默认 `contextWindow` 是 `200000`
- session 默认 `maxTurns` 是 `50`，接口允许的上限是 `200`
- 默认启用的 capability packs 是 `workspace` 和 `schedule`
- 用户级 settings 已持久化到 `agent_settings`，当前包含：
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

## 关于 `apps/worker`

- 当前仓库里存在 `apps/worker/` 目录和残留构建产物
- 但它没有 `package.json`，也不在根工作区脚本的实际启动链路中
- 因此它应被视为历史残留或未启用目录，而不是当前运行架构的一部分

## 推荐阅读顺序

- 想先建立全局认知：读 `docs/architecture/diagram.md`
- 想判断主线与专项能力边界：读 `docs/architecture/capability-packs.md`
- 想确认目录职责和模块归属：读 `docs/architecture/workspace-structure.md`
- 想确认技术事实而不是计划：读 `docs/architecture/tech-stack.md`
