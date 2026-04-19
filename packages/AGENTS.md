# AGENTS.md

本文件作用域覆盖：

- `packages/`
- 以及其所有子目录

## 共享包规则

- `packages/` 只放跨应用复用的共享能力
- 共享包优先保持边界清楚、依赖方向单一、命名贴近职责
- 不要把某个应用专属的页面逻辑、运行时胶水代码或临时脚本放进共享包

## 当前目录建议

- `packages/domain` 放领域模型与业务规则
- `packages/db` 放数据库 schema、迁移与持久化访问
- `packages/agent` 放 agent runtime、状态、工具绑定与 prompts
- `packages/sdk` 放跨端 API 客户端与契约封装
- `packages/ui` 放基础组件与通用业务组件
- `packages/tokens` 放设计 tokens 与主题映射
- `packages/ui-patterns` 放页面模板与高频结构模式

## 开工前检查

- 修改 `packages/` 内文件前，先回看根目录 `AGENTS.md`
- 做设计系统、tokens、组件复用相关工作前，先阅读 `docs/design-system/` 下对应文档
- 做架构边界、共享抽象、工程结构相关工作前，先阅读 `docs/architecture/` 下对应文档
- 做模板初始化、包裁剪或包重命名时，先阅读 `docs/template/` 下对应文档
