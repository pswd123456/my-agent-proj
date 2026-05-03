# Web Search / Fetch 接入方案调研

> 注：这份文档保留当时的方案比较与取舍记录。当前实现已经移除原生 `web` capability pack，公开 web 能力通过 Firecrawl MCP 接入；当前事实请以 [Firecrawl Web 接入](../architecture/firecrawl-web.md) 为准。

更新时间：2026-04-26

## 1. 调研时仓库现状

先说结论：这个仓库已经有“网络能力底座”，但还没有“适合模型直接用的网页能力层”。

- `packages/agent/src/tools/make-http-request.ts`
  - 已提供 `make_http_request`
  - 本质是通用 HTTP 请求工具
  - `family = "workspace-network"`
  - `permissionProfile = "always-ask-user"`
- `packages/agent/src/tools/registry.ts`
  - 调研当时默认 capability pack 只有 `workspace` 和 `schedule`
  - `workspace` 里已经注册了 `make_http_request`
- `packages/domain/src/session-settings.ts`
  - `CapabilityPackName` 调研当时只有 `"workspace" | "schedule"`
- `docs/architecture/mcp-module.md`
  - 已支持从 `session.workingDirectory/.agents/.config.toml` 动态挂载 MCP tools
  - 支持 `stdio` 和 `http`
  - MCP 工具统一纳入现有 permission / trace / tool registry 主链路

所以这里其实有两条路：

1. 直接接现成 MCP server，先验证产品价值
2. 在仓库内正式新增一个 `web` capability pack，把 `web_search` / `web_fetch` 做成原生工具

不太推荐第三条路：继续依赖 `make_http_request` 让模型自己拼搜索 API、自己理解 HTML、自己处理结果。这个层级太低，模型调用成本高，trace 也不够语义化。

## 2. 这次重点看的外部方案

这次优先看了四类更贴近 agent 的官方方案：

### A. Tavily

- Search API：面向 agent 的搜索接口，支持 `search_depth`、`topic`、时间过滤、domain include/exclude、可选 answer、可选 raw content
- Extract API：按 URL 拉取清洗后的 markdown / text
- Crawl API：可按站点爬取并返回内容
- MCP：官方提供 remote MCP，也支持本地 `npx`

更像“agent-first 的搜索 + 提取平台”。

### B. Exa

- Search API：`/search` 可直接返回搜索结果，支持 `auto / neural / fast / deep`
- Contents API：`/contents` 可按 URL 返回页面正文
- MCP：官方 remote MCP 已经直接暴露 `web_search_exa` / `web_fetch_exa`

更像“为 LLM 准备好的 web search / contents 层”，而且 MCP 形态非常贴合当前仓库。

### C. Firecrawl

- Search：`/search` 支持搜索后直接带 `scrapeOptions` 把结果内容抓回来
- Scrape：`/scrape` 支持 markdown / html / json / screenshot / links
- Interact：支持浏览器动作、动态页面交互
- MCP：官方提供 remote MCP 和本地 `npx`

更强，但也明显更重；如果只是做“查网页 + 读正文”，有点超配。

### D. Brave Search API

- Web Search：传统搜索 API，但能力很完整，有 freshness、country、language、extra snippets、operators
- LLM Context：单次调用直接返回预提取内容，定位就是给 agent / RAG 用
- Answers：OpenAI-compatible 的 grounded answers 接口

更像“搜索基础设施 + agent 友好的上下文接口”，而不是完整的抓取平台。

## 3. 对当前仓库最相关的判断

### 方案一：先走 MCP，最快验证

这是和当前架构最顺的一条路。

原因：

- 仓库已经有 `.agents/.config.toml -> MCP -> ToolRegistry` 主链路
- MCP 工具天然复用当前审批、trace、session 恢复和 mounted tools 感知
- 不需要先改 `CapabilityPackName`、settings、API 契约和前端开关
- 可以先用真实任务验证：模型到底更需要“搜索”还是“抓正文 / crawl / 动态页面”

适合的候选：

- 想最小步拿到 `web_search + web_fetch`：`Exa MCP`
- 想偏新闻 / 实时搜索 / extract：`Tavily MCP`
- 想连动态页面、交互、截图一起要：`Firecrawl MCP`

### 方案二：正式内建 `web` capability pack

如果确认这是主线能力，而不是某个 workspace 的临时扩展，就该做原生 pack。

原因：

- 现在 MCP 工具默认统一 `always-ask-user`，粒度还比较粗
- MCP tool name 会带 `mcp__<server>__<tool>`，对产品层和权限设置不够稳定
- 原生 pack 更适合做统一结果结构、prompt 约束、后续 UI 开关和 provider 切换
- 后面如果要做 source card、search citation、domain policy、缓存、配额统计，原生更顺

适合的候选 provider：

- 默认推荐：`Tavily` 或 `Brave + LLM Context`
- 如果强调“搜索结果自带 clean content”：`Exa`
- 如果未来要动态网页/交互：`Firecrawl`

### 方案三：继续扩展 `make_http_request`

不推荐作为主方案。

问题：

- 搜索请求参数、认证方式、结果结构都暴露给模型
- 网页正文抽取要么交给第三方 API，要么自己补 HTML 清洗逻辑
- trace 只有“发了个 HTTP 请求”，没有“做了一次 web_search / web_fetch”的语义层
- 后面要做 domain allowlist、抓取深度、结果裁剪、去重、citation，很快又会长出新工具

## 4. 候选方案对比

| 方案                       | 最适合的目标                            | 和当前仓库的贴合度 | 风险/代价                                    |
| -------------------------- | --------------------------------------- | ------------------ | -------------------------------------------- |
| Exa MCP                    | 最快补齐 `web_search + web_fetch`       | 很高               | 受 MCP 默认审批和外部 tool naming 约束       |
| Tavily MCP                 | 搜索 + extract + crawl，偏 agent 工作流 | 很高               | 搜索参数较多，后期可能仍想收敛成原生工具     |
| Firecrawl MCP              | 需要 scrape / dynamic / interact        | 中高               | 能力过宽，成本和复杂度都更高                 |
| 原生 Tavily / Exa / Brave  | 要把 web 做成 repo 主线能力             | 高                 | 需要改 capability pack、权限、settings、测试 |
| 继续用 `make_http_request` | 临时实验                                | 低                 | 模型负担重，维护性差                         |

## 5. 推荐路线

### 推荐路线 A：先接 MCP，再决定是否内建

这是我最推荐的路线。

#### 阶段 1：用 MCP 快速验证

优先顺序建议：

1. `Exa MCP`
2. `Tavily MCP`
3. `Firecrawl MCP`（仅在确认需要动态网页时）

理由：

- `Exa MCP` 已经直接暴露 `web_search_exa` 和 `web_fetch_exa`
- 这和你现在说的“考虑接个 web fetch 和 web search”几乎一一对应
- 对当前仓库来说，最少改动就能看到模型行为

#### 阶段 2：如果高频使用，再收编成原生 `web` pack

判断信号：

- 这个能力不是某个 workspace 特例，而是 workbench 主线常用能力
- 需要稳定的 tool name，例如固定成 `web_search` / `web_fetch`
- 需要把审批、缓存、引用格式、来源展示做成统一产品行为
- 需要 provider fallback 或 A/B（如 `Tavily` / `Brave` / `Exa` 切换）

### 推荐路线 B：直接做原生，但 provider 用外部 API

如果你已经基本确定这是主线能力，也可以直接做原生，不先走 MCP。

我会优先这样选 provider：

- `web_search`：`Tavily Search` 或 `Brave Web Search`
- `web_fetch`：`Tavily Extract`、`Brave LLM Context`、或 `Exa Contents`

我的偏好：

- 偏产品 MVP：`Tavily Search + Tavily Extract`
- 偏成本可控和基础设施感：`Brave Web Search + Brave LLM Context`
- 偏“给模型干净内容、少自己做抽取”：`Exa Search + Exa Contents`

## 6. 如果在仓库里正式落地，建议怎么分层

建议新增一个 `web` capability pack，而不是把逻辑塞进 `make_http_request`。

### 6.1 领域与契约层

建议新增：

- `packages/domain/src/web.ts`
  - `WebSearchResult`
  - `WebFetchResult`
  - `WebSource`
  - provider 归一化后的 metadata

目标是把 provider-specific 字段藏在适配层后面。

### 6.2 agent tools 层

建议新增：

- `packages/agent/src/tools/web-search.ts`
- `packages/agent/src/tools/web-fetch.ts`
- 可选：`packages/agent/src/tools/web-shared.ts`

工具名建议固定为：

- `web_search`
- `web_fetch`

输入建议尽量收敛：

`web_search`

- `query`
- `maxResults`
- `domains`
- `topic`
- `timeRange`
- `includeContent`

`web_fetch`

- `url` 或 `urls`
- `query`（可选，用于 extract rerank）
- `format`（默认 markdown）
- `timeoutMs`

### 6.3 provider 适配层

建议新增：

- `packages/agent/src/web/provider.ts`
- `packages/agent/src/web/providers/tavily.ts`
- `packages/agent/src/web/providers/exa.ts`
- `packages/agent/src/web/providers/brave.ts`

接口可以非常简单：

```ts
interface WebProvider {
  search(input: WebSearchInput): Promise<WebSearchResult>;
  fetch(input: WebFetchInput): Promise<WebFetchResult>;
}
```

这样以后才方便切 provider，不会把 provider 逻辑写进工具里。

### 6.4 capability pack 注册

需要改：

- `packages/domain/src/session-settings.ts`
  - 新增 `"web"`
- `packages/agent/src/tools/registry.ts`
  - 新增 `createWebToolRegistry()`
- `apps/api/src/index.ts`
  - 把 provider 配置注入 runtime 装配
- `packages/domain/src/permission-rules.ts`
  - 把 `web_search` / `web_fetch` 纳入 permission tool options

### 6.5 权限建议

第一版建议：

- `web_search`: `always-ask-user`
- `web_fetch`: `always-ask-user`

原因不是它们一定高风险，而是当前仓库对 `workspace-network` 的默认心智已经是“网络请求走审批”。

但如果后续确认这是高频基础能力，我更建议：

- `web_search` 默认 ask，但允许 session 级 allow
- `web_fetch` 默认 ask，但支持域名级 allowlist

这会比现在单纯按 tool name 放行更合理，不过那已经是第二阶段优化了。

### 6.6 结果结构建议

不要把 provider 原始 payload 直接吐给模型。

建议统一成：

`web_search`

- `query`
- `results[]`
  - `title`
  - `url`
  - `snippet`
  - `publishedAt`
  - `domain`
  - `score`
- `provider`

`web_fetch`

- `url`
- `finalUrl`
- `title`
- `content`
- `format`
- `metadata`
  - `publishedAt`
  - `author`
  - `statusCode`
  - `contentType`
- `provider`

工具返回给模型的 display text 应该尽量短，详细结构放 `result.data`。

## 7. 我当前的明确建议

如果你现在只是“考虑接一下，想先看看值不值得”，我建议：

1. 先用 `Exa MCP` 跑通一轮
2. 再用 `Tavily MCP` 跑一轮
3. 对比模型在真实任务里的表现：搜出来的相关性、正文可读性、延迟、审批体验
4. 只有确认这是高频主线能力，再正式做原生 `web` capability pack

如果你现在已经偏向“这个能力大概率会进主线”，那我建议直接按下面组合做原生：

- `web_search` -> `Tavily Search`
- `web_fetch` -> `Tavily Extract`

这是当前最均衡的一组：接口语义直、agent 导向强、搜索和提取拆分清楚，后续要扩到 crawl 也自然。

如果你更看重“少做抽取清洗、让模型直接吃干净内容”，那第二推荐是：

- `web_search` -> `Exa Search`
- `web_fetch` -> `Exa Contents`

如果你更看重“后续可能会读 JS 页面、登录后页面、甚至操作页面”，那再上：

- `Firecrawl`

但我不建议一开始就把 Firecrawl 当默认方案。

## 8. 这轮调研后的落地建议

建议下一步只做一件小事：

- 先写一个 workspace 级 `.agents/.config.toml`，挂一个 `Exa` 或 `Tavily` 的 remote MCP

这样你可以先验证三件关键事情：

- 当前 prompt 会不会自然学会用它
- 现在的统一审批体验是否足够顺手
- tool result 的长度和结构是否会给上下文带来压力

如果这三件都没问题，再收编成 repo 原生能力，收益会更稳。

## 参考资料

- Tavily Search API: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Tavily Extract API: https://docs.tavily.com/documentation/api-reference/endpoint/extract
- Tavily MCP: https://docs.tavily.com/documentation/mcp
- Exa Search API: https://docs.exa.ai/reference/search
- Exa Contents API: https://docs.exa.ai/reference/get-contents
- Exa MCP: https://exa.ai/docs/reference/exa-mcp
- Firecrawl Search: https://docs.firecrawl.dev/features/search
- Firecrawl Scrape: https://docs.firecrawl.dev/features/scrape
- Firecrawl MCP: https://docs.firecrawl.dev/mcp-server
- Brave Web Search: https://api-dashboard.search.brave.com/app/documentation/web-search/codes
- Brave LLM Context: https://api-dashboard.search.brave.com/documentation/services/llm-context
- Brave Answers: https://api-dashboard.search.brave.com/documentation/services/answers
