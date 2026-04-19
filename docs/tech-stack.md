# 技术栈方案

这份文档改为技术栈入口页，详细内容已拆分到 `docs/architecture/`。

## 快速结论

- 主栈：`TypeScript` + `Bun workspace` + `Turborepo`
- Web：`Next.js`
- API：`Hono` + `Zod` + `OpenAPI`
- Agent：`LangGraph.js`
- 数据层：`PostgreSQL` + `Drizzle ORM`
- 鉴权：`Better Auth`
- 异步任务：`pg-boss`

## 详细文档

- [项目概览](./architecture/overview.md)
- [技术栈选择](./architecture/tech-stack.md)
- [工作目录与模块分层](./architecture/workspace-structure.md)
