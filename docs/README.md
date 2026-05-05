# 文档索引

当前文档按主题拆分，避免单篇过长。

## 入口

- [设计契约入口](../DESIGN.md)
- [模板初始化](./template/README.md)
- [技术栈总览](./tech-stack.md)
- [架构文档目录](./architecture/README.md)
- [API 与 SDK 边界](./architecture/api-and-sdk-boundary.md)
- [持久化与 Session 状态模型](./architecture/persistence-and-session-state.md)
- [Session Fork 与 Rewrite](./architecture/session-fork-and-rewrite.md)
- [前端 Workbench 架构](./architecture/frontend-workbench.md)
- [Tool 编排与执行边界](./architecture/tool-orchestration.md)
- [内建 LSP Capability Pack](./architecture/lsp-capability-pack.md)
- [Firecrawl Web 接入](./architecture/firecrawl-web.md)
- [后台任务与 delegation](./architecture/background-tasks-and-delegation.md)
- [工作区 `.agents/` 运行配置](./architecture/workspace-agent-config.md)
- [MCP 模块落地](./architecture/mcp-module.md)
- [Trace / Log 排查](./architecture/trace-debugging.md)
- [阶段文档目录](./plan/README.md)
- [调查文档目录](./investigation/README.md)
- [Todo 文档目录](./todo/README.md)
- [主线与能力包](./architecture/capability-packs.md)
- [Context 管理](./architecture/context-management/README.md)
- [折叠消息块 Hydration 回归](./architecture/context-management/collapsed-flow-hydration.md)
- [设计系统总览](./design-system/README.md)

## 使用建议

- 做 UI、视觉统一、AI 生成页面相关工作时，先看根目录 `DESIGN.md`，再进入 `docs/design-system/`
- 刚复制模板时，先看 `docs/template/`
- 做技术栈、工程结构、架构边界相关工作时，从 `docs/architecture/` 开始
- 做 API 契约、runtime 装配点或 Web 调用边界相关工作时，优先看 `docs/architecture/api-and-sdk-boundary.md` 和 `docs/architecture/firecrawl-web.md`
- 做 cron job 管理接口、调度触发或它与后台任务的关系时，优先看 `docs/architecture/api-and-sdk-boundary.md`、`docs/architecture/background-tasks-and-delegation.md` 和 `docs/architecture/persistence-and-session-state.md`
- 做 tool 调度、权限等待、工具结果持久化或并发执行边界时，优先看 `docs/architecture/tool-orchestration.md`
- 做 session/settings/background task 的状态归属、数据表和持久化边界时，优先看 `docs/architecture/persistence-and-session-state.md`
- 做 session fork、历史改写重试、checkpoint replay 或 fork session 关系定位时，优先看 `docs/architecture/session-fork-and-rewrite.md`
- 做 LSP 工具、server 生命周期或默认 capability pack 判断时，优先看 `docs/architecture/lsp-capability-pack.md`
- 判断“当前实现事实”时，优先看 `docs/architecture/` 和代码；`docs/plan/`、`docs/investigation/`、`docs/todo/` 更多是阶段规格、调研记录或验收口径
- 做工作区 instructions、skills 或 MCP 配置输入时，优先看 `docs/architecture/workspace-agent-config.md`；做 MCP 工具挂载、权限和 trace 链路时，再看 `docs/architecture/mcp-module.md`
- 做 trace / system log 排查、session 级诊断或 prompt/tool/permission 链路定位时，优先看 `docs/architecture/trace-debugging.md`
- 如果要判断“仓库主线是什么、哪些只是专项能力”，优先看 `docs/architecture/capability-packs.md`
- 做 messages 管理、compact、tool result 上下文或 prompt 分层时，优先看 `docs/architecture/context-management/`
- 做前端 workbench 的消息 dedupe、折叠、stream overlay 或 inspector 编排时，也优先看 `docs/architecture/context-management/`
- 如果问题表现为折叠消息块在切换 session 后闪一下再消失，直接看 `docs/architecture/context-management/collapsed-flow-hydration.md`
- 做 workbench 本身的前端状态分层、shared UI 包边界或 session 页面编排时，优先看 `docs/architecture/frontend-workbench.md`
- 做模型目录、默认模型或 `thinkingEffort` 支持判断时，优先看 `docs/architecture/tech-stack.md` 和 `packages/agent/src/models/service.ts`
- 做 UI、一致性、tokens、组件策略、页面模板相关工作时，从 `docs/design-system/` 开始
- 若某项约定已经沉淀为专题文档，后续应优先更新专题文档，而不是把补充内容继续加回入口页
- `docs/plan/` 主要保留阶段规划、实现规格和历史演进，不是判断当前运行现状的首选入口
- `docs/investigation/` 保留调研与方案比较，`docs/todo/` 保留待办和后续专项；它们都不是判断当前实现事实的第一入口

当前仓库的应用入口包括 `apps/api`、`apps/web`、`apps/worker` 和 `apps/gateway`；如果未来新增应用，继续放在 `apps/` 下并补充对应文档。

## 当前推荐事实源

- API 路由、请求体和返回结构以 `apps/api/src/app.ts` 为准
- session 默认值、capability pack 默认装配和 `maxTurns`/`contextWindow` 上限以 `packages/domain/src/session-settings.ts` 为准
- runtime 实际装配方式以 `packages/agent/src/runtime/assembly.ts` 为准，`apps/api/src/index.ts` 与 `apps/worker/src/index.ts` 负责把它接到各自进程入口
- 外部常驻 channel / gateway 入口以 `apps/gateway/src/index.ts` 为准，当前负责 Telegram polling 并转发到 API webhook
- cron job 调度定义与触发链路以 `apps/api/src/app.ts`、`packages/agent/src/cron/dispatcher.ts` 和 `apps/worker/src/index.ts` 为准
- 模型目录、默认模型选择和 `thinkingEffort` 支持矩阵以 `packages/agent/src/models/service.ts` 为准
- tool 调度、权限检查和结果持久化以 `packages/agent/src/runtime/run-loop.ts` 与 `packages/agent/src/runtime/tool-execution.ts` 为准
- tool surface 与 capability pack 装配以 `packages/agent/src/tools/registry.ts` 为准
- 数据表、settings 和 session 持久化字段以 `packages/db/src/schema.ts` 为准
- trace、权限流和工具执行边界以 `packages/agent/src/` 下对应实现为准
