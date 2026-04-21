# my-agent-proj

一个以 `TypeScript` + `Bun` 为主栈的 agent runtime 实验仓库，当前包含：

- `apps/web`：Web workbench
- `apps/api`：会话、执行、trace、routine 相关 API
- `packages/agent`：runtime、session、tools、trace
- `packages/db`：PostgreSQL schema 与持久化访问

当前默认是单开发者 + Codex 持续推进的工作流，整体遵循“重后端、轻前端”。

## 技术栈

- Monorepo：`Bun workspace` + `Turborepo`
- Web：`Next.js`
- API：`Hono`
- Agent Runtime：`LangGraph.js`
- 数据层：`PostgreSQL` + `Drizzle ORM`

更完整说明见 [docs/tech-stack.md](./docs/tech-stack.md) 和 [docs/architecture/README.md](./docs/architecture/README.md)。

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
- `WEB_PORT`：当前仍保留在 `.env.example` 中，Web 本地开发默认使用 `3000`

如果要真正跑 agent 执行链路，还需要配置模型相关变量：

- `API_KEY` 或 `MINIMAX_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- 可选：`ANTHROPIC_TOOL_CHOICE=auto|any|none|tool:<name>`

### 3. 启动开发环境

直接从仓库根目录启动全部开发服务：

```bash
bun dev
```

当前根命令会并行启动：

- `apps/api`：默认 `http://localhost:3001`
- `apps/web`：默认 `http://localhost:3000`

如果只想单独启动某一端，可以分别在两个终端里运行：

```bash
cd apps/api && bun dev
```

```bash
cd apps/web && bun dev
```

说明：当前仓库默认没有独立 `worker` 进程，README 里的启动命令以 `web + api` 为准。

## 常用命令

```bash
bun lint
bun typecheck
bun build
```

几个常用 smoke 命令：

```bash
bun run minimax:smoke
bun run stage1:smoke
bun run ui1:api-smoke
bun run ui1:runtime-smoke
bun run ui1:web-smoke
```

## API 与 Runtime 调试

启动 API 后，可以先检查：

```bash
curl http://localhost:3001/health
```

最小 session 调试流程：

1. `POST /sessions` 创建 session
2. `POST /sessions/:sessionId/execute` 发起执行
3. `POST /sessions/:sessionId/execute/stream` 查看流式事件
4. `GET /sessions/:sessionId/trace` 读取 trace
5. 或直接查看 `tmp/agent-sessions/sessions/<sessionId>.trace.jsonl`

这个仓库里，`thinking` 会写入 trace，但不会回灌到下一轮 `messages`。

## 文档入口

- [文档索引](./docs/README.md)
- [技术栈总览](./docs/tech-stack.md)
- [架构文档目录](./docs/architecture/README.md)
- [设计系统总览](./docs/design-system/README.md)
- [模板初始化说明](./docs/template/README.md)
