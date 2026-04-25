# 架构文档目录

## 文档列表

- [项目概览](./overview.md)
- [主线与能力包](./capability-packs.md)
- [架构图](./diagram.md)
- [Context 管理](./context-management/README.md)
- [技术栈选择](./tech-stack.md)
- [工作目录与模块分层](./workspace-structure.md)
- [工作区 `.agent/` 运行配置](./workspace-agent-config.md)
- [MCP 模块落地](./mcp-module.md)

## 阅读建议

- 首次进入项目时，先读 [项目概览](./overview.md)，了解当前真实的运行主链路
- 如果想确认仓库默认主线和产品能力边界，接着读 [主线与能力包](./capability-packs.md)
- 想快速建立全局心智模型时，接着读 [架构图](./diagram.md)
- 做 messages、compact、tool result 或 prompt 分层相关工作时，读 [Context 管理](./context-management/README.md)
- 做依赖选型、provider 接入或运行时边界判断时，读 [技术栈选择](./tech-stack.md)
- 做目录规划、模块归属、文档同步或新增模块时，读 [工作目录与模块分层](./workspace-structure.md)
- 做工作区 skills / MCP 配置相关工作时，读 [工作区 `.agent/` 运行配置](./workspace-agent-config.md)
- 做工作区 MCP 挂载、权限、trace 或模块拆分时，读 [MCP 模块落地](./mcp-module.md)

## 使用边界

- 这里描述的是“当前运行架构”和“稳定工程约定”
- 阶段性方案、历史草稿和 capability 专项规格放在 `docs/plan/`
- 如果架构文档和代码冲突，以当前实现为准，再回写文档
