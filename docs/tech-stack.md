# 技术栈总览

这份文档是技术栈入口页，只保留当前已落地的高层事实和跳转链接；更细的实现边界见 `docs/architecture/`。

## 快速结论

- 主栈：`TypeScript` + `Bun workspace` + `Turborepo`
- Web：`Next.js 16` + `React 19` + `Tailwind CSS 4`
- API：`Hono` + `Zod`
- Worker：`apps/worker` 轮询 `background_tasks` 并复用 agent runtime
- Gateway：`apps/gateway` 负责 Telegram polling 这类常驻外部接入，再转交 API
- Agent：仓库内自定义 runtime loop + Anthropic-compatible 模型服务（`MiniMax-M2.7` / `deepseek-v4-pro` / `deepseek-v4-flash`）
- 数据层：`PostgreSQL` + `Drizzle ORM` + `postgres` 驱动

## 判断现状时看哪里

- API 装配：`apps/api/src/index.ts`
- API 契约：`apps/api/src/app.ts` 与 `apps/api/src/*-routes.ts`
- 外部接入入口：`apps/gateway/src/index.ts`
- runtime/provider：`packages/agent/src/`
- 模型目录与默认模型：`packages/agent/src/models/service.ts`
- session 默认值：`packages/domain/src/session-settings.ts`
- 数据表：`packages/db/src/schema.ts`

## 详细文档

- [项目概览](./architecture/overview.md)
- [架构图](./architecture/diagram.md)
- [技术栈选择](./architecture/tech-stack.md)
- [工作目录与模块分层](./architecture/workspace-structure.md)
