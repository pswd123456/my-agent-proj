# AGENTS.md

作用域：`packages/` 及其子目录。

## 目录职责

- `packages/` 只放跨应用复用的共享能力
- 共享包保持边界清楚、依赖方向单一、命名贴近职责
- 不要把应用专属页面逻辑、运行时胶水代码或临时脚本放进共享包

## 当前分层建议

- 领域模型与业务规则放领域包
- 数据库 schema、迁移与持久化访问放数据包
- agent runtime、状态、工具绑定与 prompts 放 agent 包
- 跨端 API 客户端与契约封装放 sdk 包
- 基础组件、tokens、页面 patterns 放各自共享包

## 开工前检查

- 先回看根目录 `AGENTS.md`
- 做设计系统、tokens、组件复用相关工作前，先看 `docs/design-system/`
- 做架构边界、共享抽象、工程结构相关工作前，先看相关架构文档
- 做模板初始化、包裁剪或包重命名前，先看 `docs/template/`
