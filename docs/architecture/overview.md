# 项目概览

## 定位

- 本仓库当前已经不是纯模板说明，而是一个围绕“日程管理 agent”演进的 `TypeScript` 全栈 MVP
- 整体协作仍然遵循“重后端、轻前端”：先把 runtime、session、tool、trace 和数据层边界做对，再补产品层体验
- 当前代码中的 workspace 包名仍使用 `@ai-app-template/*` 前缀，这是现阶段的实现命名，不影响实际分层判断

## 当前主链路

- `apps/web` 提供当前的工作台式 Web UI，负责会话列表、对话输入、流式输出和 trace / prompt / tool 观察
- `packages/sdk` 负责把 Web 对 API 的调用封装成稳定客户端
- `apps/api` 是当前唯一权威入口，负责创建 session、触发执行、输出 SSE 流、暴露 trace 和 routine 查询接口
- `packages/agent` 提供实际的 agent runtime：prompt builder、模型适配、tool registry、session manager、trace manager 和执行循环
- `packages/db` 负责 PostgreSQL 连接、schema 初始化和 `RoutineRepository`
- `packages/domain` 负责日程、session context、tool result 等纯领域结构和校验辅助

## 当前运行模型

- 真实 loop 入口在 [`packages/agent/src/runtime.ts`](/Users/boneda/gitrepo/my-agent-proj/packages/agent/src/runtime.ts)
- API 在 [`apps/api/src/index.ts`](/Users/boneda/gitrepo/my-agent-proj/apps/api/src/index.ts) 中组装 runtime：模型 client、session manager、routine repository、tool registry、trace manager 和 prompt builder
- session 主存储当前走 PostgreSQL；trace 走 `tmp/agent-sessions/sessions/<sessionId>.trace.jsonl`
- provider 侧当前通过 `Anthropic SDK` 访问 MiniMax 的 Anthropic-compatible 接口
- 一次执行的核心闭环是：`user message -> runtime.run -> model response -> tool call/result -> next turn or final answer`

## 当前交付范围

- `Web MVP` 已经落地，重点是可观测的调试工作台，而不是最终消费级 UI
- `API + agent runtime + PostgreSQL` 是当前最稳定、最应优先维护的主链路
- `apps/worker` 对应恢复卡住 session 的后台进程思路；当前仓库里保留了其构建产物，后续若继续启用，应补回源码并继续复用同一套 runtime 装配方式
- 后续若扩展到 iOS、小程序或桌面端，应优先复用 `sdk`、领域模型和 runtime 能力，而不是复制 UI 逻辑

## 当前文档应该回答什么

- 如果你想知道“系统现在到底怎么跑”，先看 [架构图](./diagram.md)
- 如果你想知道“哪些技术已经真的落地，哪些还只是模板遗留或预留”，看 [技术栈选择](./tech-stack.md)
- 如果你想知道“新能力该放在哪一层”，看 [工作目录与模块分层](./workspace-structure.md)
