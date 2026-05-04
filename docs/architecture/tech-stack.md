# 技术栈选择

## 先说结论

- 当前已落地的主栈是：`TypeScript` + `Bun workspace` + `Turborepo`
- 前端是 `Next.js 16` + `React 19` + `Tailwind CSS 4`
- API 是 `Hono` + `Zod`
- agent runtime 是仓库内自定义的 `AgentRuntime.run` 执行循环
- 后台执行入口是 `apps/worker`，和 API 共享同一套 runtime、数据库与任务模型
- 外部常驻接入入口是 `apps/gateway`，当前负责 Telegram polling，后续可扩展其他主动对外 gateway 服务
- 数据层是 `PostgreSQL` + `Drizzle ORM` + `postgres` 驱动
- 模型接入当前通过 `Anthropic SDK` 对接 Anthropic-compatible endpoint，并由统一模型服务在 MiniMax 与 DeepSeek 之间做选择

## 已落地实现

### 工程与语言

- 语言统一为 `TypeScript`
- 包管理与 workspace 工具统一为 `Bun`
- 多包编排使用 `Turborepo`

### Web 层

- `apps/web` 使用 `Next.js App Router`
- UI 基础依赖是 `React 19`
- 样式当前采用 `Tailwind CSS 4`
- `packages/sdk` 提供 Web 侧 API client、会话摘要转换和跨层类型
- 页面模式和工作台布局下沉在 `packages/ui-patterns`
- 基础组件沉淀在 `packages/ui`
- 设计 token 的运行时真相源在 `packages/tokens`

### API 与客户端契约

- `apps/api` 使用 `Hono`
- 请求入参校验使用 `Zod`
- 当前 API 契约以代码和 SDK 为准，`OpenAPI` 尚未落地为权威源
- Telegram inbox adapter v1 的 HTTP 处理仍挂在 `apps/api`；本地 polling 常驻入口移到 `apps/gateway`，由 gateway 调 Bot API long polling 后转交 API webhook。公网部署时可切到 webhook，同样通过同一套 session/runtime 边界执行

### Agent Runtime

- runtime 门面在 `packages/agent/src/runtime.ts`，核心执行循环在 `packages/agent/src/runtime/run-loop.ts`
- API / worker 共用的运行时装配收口在 `packages/agent/src/runtime/assembly.ts`
- prompt 拼装在 `packages/agent/src/prompt.ts`
- provider 适配在 `packages/agent/src/model.ts`
- 统一模型服务在 `packages/agent/src/models/`
- session 抽象和当前唯一落地的 PostgreSQL 实现在 `packages/agent/src/session/`
- 后台任务和 delegated subagent 实现在 `packages/agent/src/background-tasks/` 与 `packages/agent/src/delegation/`
- MCP 工作区挂载实现在 `packages/agent/src/mcp/`
- runtime 已落地 permission checker、interrupt、history compact 和 system log 边界
- workspace skill discovery 与启停过滤在 `packages/agent/src/skills/`
- tool registry 与具体工具在 `packages/agent/src/tools/`
- trace 以 JSONL 追加写入 `tmp/agent-sessions/sessions/`；system log 以结构化 JSONL 写入 `tmp/agent-sessions/logs/` 并按大小轮转

### 模型兼容性

- 当前模型目录包含 `MiniMax-M2.7`、`deepseek-v4-pro` 和 `deepseek-v4-flash`
- 默认模型优先取 `DEFAULT_AGENT_MODEL` / `AGENT_MODEL`；若未显式指定，则按已配置 provider 顺序回退到第一个可用模型
- `deepseek-v4-pro` 走 DeepSeek 官方 Anthropic-compatible endpoint 时支持 `thinking`
- `deepseek-v4-flash` 也走 DeepSeek 官方 Anthropic-compatible endpoint，并支持当前同一套 `thinkingEffort` 选项
- 对 DeepSeek 的 `thinking + tool_use` 多轮续传，上一轮 assistant message 中的 signed `thinking` block 必须原样回放；去掉后 provider 会返回 `400`
- 本地验证中，DeepSeek 在 `thinking` 模式下若显式传 `tool_choice: { type: "tool", name: ... }` 可能返回 `deepseek-reasoner does not support this tool_choice`；当前优先使用 `tool_choice: auto`

### 数据层

- 数据库固定为 `PostgreSQL`
- 当前在线访问通过 `Drizzle ORM` 访问 `postgres` 驱动
- schema、migrations 和 repository 放在 `packages/db`
- 当前主要表包括：
  - `routines`
  - `agent_sessions`
  - `session_fork_checkpoints`
  - `session_messages`
  - `cron_jobs`
  - `inbox_bindings`
  - `background_tasks`
  - `background_task_runs`

- 单租户 settings 真相源是 TOML：
  - 全局：`~/.agents/config.toml`
  - 工作区：`<workingDirectory>/.agents/.config.toml`

当前 API 与 worker 进程都会在启动时调用 `ensureProductSchema()`，因此 schema 初始化属于运行时装配链路，而不是独立的部署服务。

## 已安装但不属于当前主链路的项

- `OpenAPI`：当前不是 API 契约权威源
- `LangGraph`：依赖存在，但 runtime 主路径不是 LangGraph 编排
- `Better Auth`：当前未接入鉴权主链路
- `pg-boss` / 向量检索 / 多模型编排：当前不在运行主链路里

## 选择原则

- 先记录“已经落地的真实运行路径”，再记录“未来想引入的能力”
- 多端复用优先收敛到 `domain`、`sdk`、`agent runtime` 和 `tokens`，不把核心语义放进某个 app 壳层
- 新技术若只停留在依赖层或计划层，不应在架构文档里表述成既成事实
