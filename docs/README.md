# 文档索引

当前文档按主题拆分，避免单篇过长。

## 入口

- [设计契约入口](../DESIGN.md)
- [模板初始化](./template/README.md)
- [技术栈总览](./tech-stack.md)
- [架构文档目录](./architecture/README.md)
- [Web 能力](./architecture/web-capability.md)
- [后台任务与 delegation](./architecture/background-tasks-and-delegation.md)
- [MCP 模块落地](./architecture/mcp-module.md)
- [Trace / Log 排查](./architecture/trace-debugging.md)
- [阶段文档目录](./plan/README.md)
- [调查文档目录](./investigation/README.md)
- [Todo 文档目录](./todo/README.md)
- [主线与能力包](./architecture/capability-packs.md)
- [Context 管理](./architecture/context-management/README.md)
- [设计系统总览](./design-system/README.md)

## 使用建议

- 做 UI、视觉统一、AI 生成页面相关工作时，先看根目录 `DESIGN.md`，再进入 `docs/design-system/`
- 刚复制模板时，先看 `docs/template/`
- 做技术栈、工程结构、架构边界相关工作时，从 `docs/architecture/` 开始
- 做工作区 MCP 配置、挂载或权限相关工作时，优先看 `docs/architecture/mcp-module.md`
- 做 trace / system log 排查、session 级诊断或 prompt/tool/permission 链路定位时，优先看 `docs/architecture/trace-debugging.md`
- 如果要判断“仓库主线是什么、哪些只是专项能力”，优先看 `docs/architecture/capability-packs.md`
- 做 messages 管理、compact、tool result 上下文或 prompt 分层时，优先看 `docs/architecture/context-management/`
- 做前端 workbench 的消息 dedupe、折叠、stream overlay 或 inspector 编排时，也优先看 `docs/architecture/context-management/`
- 做 UI、一致性、tokens、组件策略、页面模板相关工作时，从 `docs/design-system/` 开始
- 若某项约定已经沉淀为专题文档，后续应优先更新专题文档，而不是把补充内容继续加回入口页
- `docs/plan/` 主要保留阶段规划、实现规格和历史演进，不是判断当前运行现状的首选入口

当前仓库的应用入口包括 `apps/api`、`apps/web` 和 `apps/worker`；如果未来新增应用，继续放在 `apps/` 下并补充对应文档。

## 当前推荐事实源

- API 路由、请求体和返回结构以 `apps/api/src/app.ts` 为准
- session 默认值、capability pack 默认装配和 `maxTurns`/`contextWindow` 上限以 `packages/domain/src/session-settings.ts` 为准
- runtime 实际装配方式以 `apps/api/src/index.ts` 和 `apps/worker/src/index.ts` 为准
- tool surface 与 capability pack 装配以 `packages/agent/src/tools/registry.ts` 为准
- 数据表、settings 和 session 持久化字段以 `packages/db/src/schema.ts` 为准
- trace、权限流和工具执行边界以 `packages/agent/src/` 下对应实现为准
