# 架构文档目录

## 文档列表

- [项目概览](./overview.md)
- [主线与能力包](./capability-packs.md)
- [内建 LSP Capability Pack](./lsp-capability-pack.md)
- [Web 能力](./web-capability.md)
- [架构图](./diagram.md)
- [Context 管理](./context-management/README.md)
- [技术栈选择](./tech-stack.md)
- [工作目录与模块分层](./workspace-structure.md)
- [后台任务与 delegation](./background-tasks-and-delegation.md)
- [工作区 `.agent/` 运行配置](./workspace-agent-config.md)
- [MCP 模块落地](./mcp-module.md)
- [Trace / Log 排查](./trace-debugging.md)

## 阅读建议

- 首次进入项目时，先读 [项目概览](./overview.md)，了解当前真实的运行主链路
- 如果想确认仓库默认主线和产品能力边界，接着读 [主线与能力包](./capability-packs.md)
- 如果想确认内建 LSP 能力的工具面、默认值和迁移约定，读 [内建 LSP Capability Pack](./lsp-capability-pack.md)
- 想确认 `web_search` / `web_fetch` 的契约、自建 SearXNG 和本地抓取实现，读 [Web 能力](./web-capability.md)
- 想快速建立全局心智模型时，接着读 [架构图](./diagram.md)
- 做 messages、compact、tool result 或 prompt 分层相关工作时，读 [Context 管理](./context-management/README.md)
- 做前端 workbench 的消息 dedupe、折叠、stream overlay 或 inspector 编排时，也从 [Context 管理](./context-management/README.md) 进入
- 做 session 级 planning、task brief 或 plan mode 权限边界时，也从 [Context 管理](./context-management/README.md) 进入
- 做依赖选型、provider 接入或运行时边界判断时，读 [技术栈选择](./tech-stack.md)
- 做目录规划、模块归属、文档同步或新增模块时，读 [工作目录与模块分层](./workspace-structure.md)
- 做工作区 skills / MCP 配置相关工作时，读 [工作区 `.agent/` 运行配置](./workspace-agent-config.md)
- 做工作区 MCP 挂载、权限、trace 或模块拆分时，读 [MCP 模块落地](./mcp-module.md)
- 做后台任务、子代理执行或 worker 轮询链路时，读 [后台任务与 delegation](./background-tasks-and-delegation.md)
- 做 trace / system log 排查、session 级定位或 prompt/tool/permission 链路诊断时，读 [Trace / Log 排查](./trace-debugging.md)

## 使用边界

- 这里描述的是“当前运行架构”和“稳定工程约定”
- 阶段性方案、历史草稿和 capability 专项规格放在 `docs/plan/`
- 如果架构文档和代码冲突，以当前实现为准，再回写文档
