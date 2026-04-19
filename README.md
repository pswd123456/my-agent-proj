# ai-app-template

面向单开发者 + `GPT-5.4 / Codex` 的 AI-first 全栈项目模板。

## 默认方向

- `Web MVP` 优先
- 后续可扩展到 `iOS`、小程序或其他客户端
- 默认主栈以 `TypeScript`、`Bun`、`Next.js`、`Hono`、`LangGraph.js`、`PostgreSQL` 为核心
- 默认协作原则是重后端、轻前端

## 使用方式

1. 复制模板目录
2. 按 `docs/template/` 中的清单完成项目改名和裁剪
3. 根据实际产品更新领域文档、环境变量和占位实现

## 文档入口

- [文档索引](./docs/README.md)
- [模板初始化](./docs/template/README.md)
- [技术栈总览](./docs/tech-stack.md)
- [架构文档目录](./docs/architecture/README.md)
- [设计系统总览](./docs/design-system/README.md)

## 本地开发

```bash
bun install
bun dev
```

常用命令：

- `bun lint`
- `bun typecheck`
- `bun build`
