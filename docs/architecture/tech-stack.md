# 技术栈选择

## 先说结论

- 当前已落地的主栈是：`TypeScript` + `Bun workspace` + `Turborepo`
- 前端是 `Next.js 16` + `React 19` + `Tailwind CSS 4`
- API 是 `Hono` + `Zod`
- agent runtime 是仓库内自定义的 `AgentRuntime.run` 执行循环，不是现阶段由 `LangGraph` 驱动
- 数据层是 `PostgreSQL` + `postgres` 驱动
- 模型接入是 `Anthropic SDK` 对接 MiniMax Anthropic-compatible endpoint

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
- tool registry 与具体工具在 `packages/agent/src/tools/`
- trace 以 JSONL 追加写入 `tmp/agent-sessions/sessions/`

### 数据层

- 数据库固定为 `PostgreSQL`
- 当前在线访问使用 `postgres` 驱动直连
- schema 初始化与 repository 放在 `packages/db`
- 当前主要表包括：
  - `routines`
  - `agent_sessions`
  - `session_messages`

## 当前没有落地的模板项

- `OpenAPI`：文档和类型权威源目前仍然是运行代码与 `packages/sdk`，不是生成式 OpenAPI
- `Drizzle ORM`：包里有 `drizzle-kit` 依赖，但当前数据库读写主体仍是手写 SQL + `postgres`
- `Better Auth`：当前仓库未看到已接入的鉴权主链路
- `pg-boss` / 向量检索 / 多模型编排：目前都还不是运行主链路的一部分
- `LangGraph`：依赖仍保留在 `packages/agent`，但当前真实执行主入口是自定义 runtime loop

## 选择原则

- 先记录“已经落地的真实运行路径”，再记录“未来想引入的能力”
- 多端复用优先收敛到 `domain`、`sdk`、`agent runtime` 和 `tokens`，不把核心语义放进某个 app 壳层
- 新技术若只停留在依赖层或计划层，不应在架构文档里表述成既成事实
