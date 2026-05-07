# 开发与调试

这份文档收敛本地启动、环境变量、smoke 检查和 runtime 调试细节，让根目录 `README.md` 保持为更清晰的项目入口。

## 本地准备

从仓库根目录安装依赖：

```bash
bun install
```

创建本地环境文件：

```bash
cp .env.example .env
```

必填变量：

- `DATABASE_URL`：PostgreSQL 连接串
- `API_PORT`：API 端口，默认 `3001`
- `WEB_PORT`：Web 端口，默认 `3000`

agent 执行链路还需要至少配置一个模型 provider：

- `MINIMAX_API_KEY` 或 `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_MAX_TOKENS` 或 `MAX_TOKENS`，默认 `16384`
- 使用 `deepseek-v4-pro` 时需要 `DEEPSEEK_API_KEY`

可选模型与 runtime 变量：

- `DEEPSEEK_BASE_URL`
- `DEFAULT_AGENT_MODEL` 或 `AGENT_MODEL`
- `ANTHROPIC_TOOL_CHOICE=auto|any|none|tool:<name>` 或 `TOOL_CHOICE`
- `WORKER_ID`
- `WORKER_POLL_INTERVAL_MS`
- `WORKER_TASK_HEARTBEAT_MS`
- `WORKER_TASK_STALE_MS`

可选集成变量：

- `FIRECRAWL_API_KEY`：启用工作区 Firecrawl MCP server
- `TELEGRAM_BOT_TOKEN`：启用 Telegram polling inbox
- `TELEGRAM_WEBHOOK_SECRET`：启用 Telegram webhook secret header 校验
- `NEXT_PUBLIC_API_BASE_URL`：当 Web 前端不通过同源 `/api` 访问 API 时指定 API origin

内建 `lsp` capability pack 不需要单独配置 server URL。runtime 会从本地 workspace 依赖启动 `typescript-language-server`。

## 启动服务

从仓库根目录启动完整开发环境：

```bash
bun dev
```

根命令会加载 `.env`，检查配置的 PostgreSQL；当 `DATABASE_URL` 指向本地且服务未启动时，会用 `tmp/postgres-local/data` 初始化并拉起本地数据库，然后启动：

- `apps/api`：默认 `http://localhost:3001`
- `apps/web`：默认 `http://localhost:3000`
- `apps/gateway`：外部 channel ingress
- `apps/worker`：cron jobs 与 detached background tasks
- shared workspace packages 的 watcher

定位局部问题时，可以单独启动服务：

```bash
cd apps/api && bun dev
```

```bash
cd apps/web && bun dev
```

```bash
bun dev:gateway
```

```bash
bun dev:worker
```

## 常用检查

```bash
bun lint
bun typecheck
bun build
```

常用 smoke 命令：

```bash
bun run minimax:smoke
bun run db:postgres-session-smoke
bun run api:session-smoke
bun run agent:runtime-smoke
bun run web:workbench-smoke
```

## Runtime 调试

检查 API 可用性：

```bash
curl http://localhost:3001/health
```

最小 session 调试流程：

1. `POST /sessions` 创建 session。
2. `POST /sessions/:sessionId/execute` 或 `POST /sessions/:sessionId/execute/stream` 发起执行。
3. `GET /sessions/:sessionId/trace` 读取 trace。
4. `GET /system-logs` 查看 system logs。
5. `POST /sessions/:sessionId/interrupt` 中断 active run。
6. 必要时用 `POST /sessions/:sessionId/recover` 从 snapshot 恢复。

Trace JSONL 文件也会写入：

```text
tmp/agent-sessions/sessions/<sessionId>.trace.jsonl
```

runtime 会把 `thinking` 写入 trace。provider 协议要求续传的原生 `thinking + tool_use` 轮次，也会回灌到后续 model messages。

结构化 trace 检查优先使用：

```bash
bun run trace:inspect
```

## 当前事实源

需要确认文档或 runtime 现状时，优先看这些文件，而不是历史阶段文档：

- API route registration 与 request/response shape：`apps/api/src/app.ts` 和 `apps/api/src/*-routes.ts`
- API process assembly：`apps/api/src/index.ts`
- Worker process assembly：`apps/worker/src/index.ts`
- Gateway process assembly：`apps/gateway/src/index.ts`
- Runtime assembly：`packages/agent/src/runtime/assembly.ts`
- Session defaults 与 settings normalization：`packages/domain/src/session-settings.ts`
- Model catalog 与 default model selection：`packages/agent/src/models/service.ts`
- Tool surface 与 capability packs：`packages/agent/src/tools/registry.ts`
- Tool orchestration 与 permission flow：`packages/agent/src/runtime/run-loop.ts` 和 `packages/agent/src/runtime/tool-execution.ts`
- PostgreSQL schema 与 persistence fields：`packages/db/src/schema.ts`
- Web API client 与 shared response mapping：`packages/sdk/src/client.ts`

架构层阅读从 [architecture/README.md](./architecture/README.md) 和完整 [architecture diagram](./architecture/diagram.md) 开始。
