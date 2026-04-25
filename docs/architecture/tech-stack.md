# 技术栈选择

## 先说结论

- 当前已落地的主栈是：`TypeScript` + `Bun workspace` + `Turborepo`
- 前端是 `Next.js 16` + `React 19` + `Tailwind CSS 4`
- API 是 `Hono` + `Zod`
- agent runtime 是仓库内自定义的 `AgentRuntime.run` 执行循环
- 数据层是 `PostgreSQL` + `Drizzle ORM` + `postgres` 驱动
- 模型接入当前通过 `Anthropic SDK` 对接 Anthropic-compatible endpoint，默认配置指向 MiniMax

## 已落地实现

### 工程与语言

- 语言统一为 `TypeScript`
- 包管理与 workspace 工具统一为 `Bun`
- 多包编排使用 `Turborepo`

### Web 层

- `apps/web` 使用 `Next.js App Router`
- UI 基础依赖是 `React 19`
- 样式当前采用 `Tailwind CSS 4`
- 页面模式和工作台布局下沉在 `packages/ui-patterns`
- 基础组件沉淀在 `packages/ui`
- 设计 token 的运行时真相源在 `packages/tokens`

### API 与客户端契约

- `apps/api` 使用 `Hono`
- 请求入参校验使用 `Zod`
- `packages/sdk` 提供面向 Web 的 API client 和类型导出
- 当前 API 契约以代码和 SDK 为准，`OpenAPI` 尚未落地为权威源

### Agent Runtime

- 核心 loop 在 `packages/agent/src/runtime.ts`
- prompt 拼装在 `packages/agent/src/prompt.ts`
- provider 适配在 `packages/agent/src/model.ts`
- session 抽象和 PostgreSQL / file / memory 实现在 `packages/agent/src/session/`
- runtime 已落地 permission checker、interrupt、history compact 和 system log 边界
- workspace skill discovery 在 `packages/agent/src/skills/`
- tool registry 与具体工具在 `packages/agent/src/tools/`
- trace 以 JSONL 追加写入 `tmp/agent-sessions/sessions/`；system log 以结构化 JSONL 写入 `tmp/agent-sessions/logs/` 并按大小轮转

### 数据层

- 数据库固定为 `PostgreSQL`
- 当前在线访问通过 `Drizzle ORM` 访问 `postgres` 驱动
- schema、migrations 和 repository 放在 `packages/db`
- 当前主要表包括：
  - `routines`
  - `agent_sessions`
  - `session_messages`
  - `agent_settings`

## 已安装但不属于当前主链路的项

- `OpenAPI`：当前不是 API 契约权威源
- `LangGraph`：依赖存在，但 runtime 主路径不是 LangGraph 编排
- `Better Auth`：当前未接入鉴权主链路
- `pg-boss` / 向量检索 / 多模型编排：当前不在运行主链路里

## 选择原则

- 先记录“已经落地的真实运行路径”，再记录“未来想引入的能力”
- 多端复用优先收敛到 `domain`、`sdk`、`agent runtime` 和 `tokens`，不把核心语义放进某个 app 壳层
- 新技术若只停留在依赖层或计划层，不应在架构文档里表述成既成事实
