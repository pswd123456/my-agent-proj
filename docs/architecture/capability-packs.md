# 主线与能力包

## 当前主线

- 仓库主线定义调整为：一个面向个人助手场景的通用 `agent runtime`
- 默认优先支持工作区理解、文件操作、权限控制、可观测执行和可扩展的助手型能力

## 分层定义

### 1. Core runtime

这层是仓库最稳定、最通用的部分：

- 模型调用与 provider 适配
- session 生命周期与持久化
- trace / SSE / 调试可观测性
- tool 调度与执行循环
- prompt 组装与缓存边界

这层的职责是“跑通 agent”，而不是绑定某个具体产品领域。

### 2. Capability pack

能力包是挂在 runtime 上的一组领域能力，可以包含：

- 一组 tool schema 与执行实现
- 对应的 prompt 增量约束
- 必要的数据访问依赖
- 专项文档与测试

当前仓库里，`日程管理` 应视为第一个已落地的 capability pack。

它可以继续使用当前的：

- `RoutineRepository`
- `create_routine` / `edit_routine` / `delete_routine`
- confirmation 相关等待流转

## 当前建议阅读顺序

- 想理解仓库整体主线，先看 [项目概览](./overview.md)
- 想看具体日程能力怎么落地，再看 [`docs/plan/product1.md`](/Users/boneda/gitrepo/my-agent-proj/docs/plan/product1.md)
