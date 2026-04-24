# 技术栈方案

这份文档改为技术栈入口页，详细内容已拆分到 `docs/architecture/`。

## 快速结论

- 主栈：`TypeScript` + `Bun workspace` + `Turborepo`
- Web：`Next.js 16` + `React 19` + `Tailwind CSS 4`
- API：`Hono` + `Zod`
- Agent：仓库内自定义 runtime loop + MiniMax Anthropic-compatible provider
- 数据层：`PostgreSQL` + `Drizzle ORM` + `postgres` 驱动

## 详细文档

- [项目概览](./architecture/overview.md)
- [架构图](./architecture/diagram.md)
- [技术栈选择](./architecture/tech-stack.md)
- [工作目录与模块分层](./architecture/workspace-structure.md)
