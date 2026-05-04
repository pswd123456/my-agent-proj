# my-agent-proj

一个以 `TypeScript` + `Bun` 为主栈的 agent runtime 仓库。当前主线是“个人助手 workbench + 可观测 runtime”，默认支持工作区理解、文件操作、工具执行、权限等待、trace 与 settings 持久化

当前主要包含：

- `apps/web`：Web workbench
- `apps/api`：session 生命周期、执行入口、流式输出、trace、system logs、settings，以及当前已挂载的 routine API
- `apps/worker`：后台任务 worker，负责轮询并执行 detached background task
- `packages/agent`：runtime、prompt、provider 适配、session、skills、tools、trace
- `packages/db`：PostgreSQL schema、Drizzle migrations 与 repositories

当前默认是单开发者 + Codex 持续推进的工作流，整体遵循“重后端、轻前端”。

## 技术栈

- Monorepo：`Bun workspace` + `Turborepo`
- Web：`Next.js`
- API：`Hono`
- Agent Runtime：仓库内自定义 runtime loop
- 数据层：`PostgreSQL` + `Drizzle ORM` + `postgres` 驱动

更完整说明见 [docs/tech-stack.md](./docs/tech-stack.md) 和 [docs/architecture/README.md](./docs/architecture/README.md)。

如果想先搞清楚“仓库主线”和“日程能力”的边界，优先看 [docs/architecture/capability-packs.md](./docs/architecture/capability-packs.md)。

## 快速启动

### 1. 安装依赖

```bash
bun install
```

### 2. 准备环境变量

先复制一份本地环境文件：

```bash
cp .env.example .env
```

至少需要确认这些变量：

- `DATABASE_URL`：本地 PostgreSQL 连接串
- `API_PORT`：API 端口，默认 `3001`
- `WEB_PORT`：Web 端口，默认 `3000`

如果要跑 agent 执行链路，还需要配置模型相关变量：

- `MINIMAX_API_KEY` 或 `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_MAX_TOKENS` 或 `MAX_TOKENS`（默认 `16384`）
- `DEEPSEEK_API_KEY`（启用 `deepseek-v4-pro` 时必填）
- 可选：`DEEPSEEK_BASE_URL`
- 可选：`DEFAULT_AGENT_MODEL` 或 `AGENT_MODEL`
- 可选：`ANTHROPIC_TOOL_CHOICE=auto|any|none|tool:<name>` 或 `TOOL_CHOICE`
- 可选：`WORKER_ID`
- 可选：`WORKER_POLL_INTERVAL_MS`
- 可选：`WORKER_TASK_HEARTBEAT_MS`
- 可选：`WORKER_TASK_STALE_MS`
- 可选：`TELEGRAM_BOT_TOKEN`（启用 Telegram polling inbox）
- 可选：`TELEGRAM_WEBHOOK_SECRET`（仅 webhook 模式需要，校验 Telegram webhook secret header）

另外，`web` 和 `lsp` 这两组能力的外部依赖是：

- `web`：需要自建或本地启动的 SearXNG 服务，默认基址是 `http://127.0.0.1:8888`
- `lsp`：不需要单独配置 URL，运行时会从 `packages/agent` 依赖里本地拉起 `typescript-language-server`
- `NEXT_PUBLIC_API_BASE_URL`：可选，Web 前端如果不是通过同源 `/api` 访问 API，就显式填成 `http://127.0.0.1:3001`

如果要启用 `web_search`，先启动 SearXNG：

```bash
bun run searxng:up
```

### 3. 启动开发环境

直接从仓库根目录启动全部开发服务：

```bash
bun dev
```

当前根命令会并行启动：

- `apps/api`：默认 `http://localhost:3001`
- `apps/web`：默认 `http://localhost:3000`
- `apps/gateway`：Telegram polling 与后续外部常驻接入

如果只想单独启动某一端，可以分别运行：

```bash
cd apps/api && bun dev
```

```bash
cd apps/web && bun dev
```

```bash
bun dev:gateway
```

后台任务 worker 单独启动：

```bash
bun dev:worker
```

## 常用命令

```bash
bun lint
bun typecheck
bun build
```

几个常用 smoke 命令：

```bash
bun run minimax:smoke
bun run db:postgres-session-smoke
bun run api:session-smoke
bun run agent:runtime-smoke
bun run web:workbench-smoke
```

## API 与 Runtime 调试

启动 API 后，可以先检查：

```bash
curl http://localhost:3001/health
```

最小 session 调试流程：

1. `POST /sessions` 创建 session
2. `POST /sessions/:sessionId/execute` 或 `POST /sessions/:sessionId/execute/stream` 发起执行
3. `GET /sessions/:sessionId/trace` 读取 trace
4. `GET /system-logs` 查看运行日志
5. 必要时用 `POST /sessions/:sessionId/interrupt` 中断，或用 `POST /sessions/:sessionId/recover` 恢复快照
6. 或直接查看 `tmp/agent-sessions/sessions/<sessionId>.trace.jsonl`

当前 runtime 会把 `thinking` 写入 trace；对于 provider 要求续传的原生 `thinking + tool_use` 轮次，也会按协议要求回灌到下一轮 `messages`。

## 当前事实源

需要确认现状时，优先看下面这些文件而不是历史阶段文档：

- API 路由与请求体：`apps/api/src/app.ts`
- API 装配与默认 runtime：`apps/api/src/index.ts`
- session 默认值与 settings 归一化：`packages/domain/src/session-settings.ts`
- 工具装配与 capability pack：`packages/agent/src/tools/registry.ts`
- PostgreSQL schema：`packages/db/src/schema.ts`

## 文档入口

- [设计契约入口](./DESIGN.md)
- [文档索引](./docs/README.md)
- [技术栈总览](./docs/tech-stack.md)
- [架构文档目录](./docs/architecture/README.md)
- [阶段文档目录](./docs/plan/README.md)
- [设计系统总览](./docs/design-system/README.md)
- [模板初始化说明](./docs/template/README.md)
