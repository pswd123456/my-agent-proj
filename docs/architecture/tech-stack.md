# 技术栈选择

## 目标与约束

- 技术选型优先考虑 AI coding 友好、文档成熟、类型一致性强
- 数据库固定为 `PostgreSQL`
- 需要兼顾 `Web MVP` 与后续多端扩展
- 默认不引入多人协作才需要的重型基础设施

## 推荐主栈

- 语言：`TypeScript`
- Web：`Next.js` `App Router`
- API：独立 `Hono` 服务 + `Zod` + `OpenAPI`
- 
- 数据层：`PostgreSQL` + `Drizzle ORM` + `drizzle-kit`
- 鉴权：`Better Auth`
- 向量能力：按需使用 `pgvector`
- 后续 iOS：`Expo` + `Expo Router`

## 关键选择原则

- Web 与 API 尽早分清边界，避免后续多端接入时再拆
- 公共契约优先以 `OpenAPI` 为核心，不把整个公共 API 绑死在 `tRPC`
- 多端复用重点放在 schema、domain、SDK、agent 能力与 tokens
