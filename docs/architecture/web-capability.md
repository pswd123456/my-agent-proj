# Web 能力

## 当前定位

`web` 是仓库内建的 capability pack，默认启用，提供两个稳定工具：

- `web_search`
- `web_fetch`

这组能力负责公开网页的搜索与正文读取，不再让模型直接拼通用 HTTP 请求、自己解析 HTML。

## 工具契约

### `web_search`

- 入参：`query` 必填，`maxResults` 默认 `5`、最大 `10`，`language` 可选，`timeRange` 可选，取值 `day | month | year`
- 行为：调用配置的 `SEARXNG_BASE_URL/search?format=json`
- 输出：只归一化普通结果，保留 `title`、`url`、`snippet`、`domain`，并可选透出 `engine`、`category`、`publishedAt`
- 失败模式：如果未配置 `SEARXNG_BASE_URL`，工具返回 `WEB_SEARCH_NOT_CONFIGURED`，runtime 本身不会因此启动失败

### `web_fetch`

- 入参：`url` 必填，`format` 默认 `markdown`，可选 `text`；`maxChars` 默认 `12000`、最大 `60000`；`timeoutMs` 默认 `20000`、最大 `60000`
- 行为：只允许 `http/https`，默认先走静态 HTTP 抓取，必要时会尝试浏览器渲染兜底；正文抽取仍优先使用 `jsdom + @mozilla/readability`，再用 `turndown` 转 markdown
- 回退：Readability 失败时回退到页面 `main` 或 `body` 的纯文本
- 输出：统一返回短 display text，结构化 `data` 里保留 `provider`、`title`、`finalUrl`、`content`、`format`、`extraction`、`truncated` 和可选元数据

## 本地 SearXNG

第一版 `web_search` 依赖仓库提供的本地 SearXNG 自建服务。

- 启动：`bun run searxng:up`
- 停止：`bun run searxng:down`
- 日志：`bun run searxng:logs`
- 绑定地址：`http://127.0.0.1:8888`

对应文件：

- [compose.yml](../../infra/searxng/compose.yml)
- [settings.yml](../../infra/searxng/settings.yml)

`SEARXNG_BASE_URL` 通过环境变量提供，`.env.example` 默认指向本地实例。

## 装配方式

- `packages/domain/src/session-settings.ts` 将 `web` 作为默认 capability pack 之一
- `packages/agent/src/tools/registry.ts` 在默认 registry 中挂载 `web_search` / `web_fetch`
- `packages/domain/src/permission-rules.ts` 将两个工具纳入运行时权限列表，但从 settings permission 列表中排除
- `apps/api/src/index.ts` 和 `apps/worker/src/index.ts` 在 runtime 装配时沿用 session 级 capability pack 选择

## 约束

- 第一版以静态抓取为主，必要时会尝试浏览器渲染兜底；不做 crawl 或多 URL 批量抓取
- 工具结果不直接透出 provider 原始 payload
- `web_search` / `web_fetch` 都使用 `workspace-network` family 和 `always-ask-user` permission profile

## 入口

- [主线与能力包](./capability-packs.md)
- [项目概览](./overview.md)
- [Web Search / Fetch 接入方案调研](../investigation/web-search-fetch-options.md)
