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

## Agent Runtime 调试

起一个新 session 并看 trace，最小流程是：

1. 先加载本地环境变量并启动 API，例如 `set -a; source .env; set +a; API_PORT=3101 bun apps/api/src/index.ts`
2. 用 `POST /sessions` 创建 session
3. 用 `POST /sessions/:sessionId/execute` 发一条任务消息
4. 用 `GET /sessions/:sessionId/trace` 读取 trace
5. 也可以直接看 `tmp/agent-sessions/sessions/<sessionId>.trace.jsonl`

这个仓库里，`thinking` 只写进 trace，不会回灌到下一轮 `messages`。
如果要显式控制工具选择，可以设置 `ANTHROPIC_TOOL_CHOICE`：
`auto`、`any`、`none` 或 `tool:<name>`。

## 本地开发

```bash
bun install
bun dev
```

常用命令：

- `bun lint`
- `bun typecheck`
- `bun build`
