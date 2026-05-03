# Firecrawl Web 接入

## 当前定位

仓库不再内建自研 `web` capability pack，也不再维护 SearXNG、Readability 或浏览器渲染兜底。公开网页搜索、抓取、站点 map、crawl 和结构化抽取统一走工作区 Firecrawl MCP；必要时可用 Firecrawl CLI 作为 shell fallback。

这保持了 runtime 主线的边界：内建工具专注工作区、日程、LSP、planning 与 MCP 装配；外部 web 能力通过 `.agents/.config.toml` 按次挂载。

## 工作区配置

当前仓库根目录提供：

```toml
[mcp_servers.firecrawl]
command = "npx"
args = ["-y", "firecrawl-mcp"]
env = { FIRECRAWL_API_KEY = "$FIRECRAWL_API_KEY" }
```

`FIRECRAWL_API_KEY` 从运行时进程环境解析，不写入仓库。根 `package.json` 的 `dev`、`db:*` 等脚本会加载 `.env`；如果从别的入口启动 API / worker，需要确保同名环境变量已在进程环境里。

MCP loader 只读取当前 `session.workingDirectory/.agents/.config.toml`。如果 session working directory 不是仓库根目录，Firecrawl MCP 需要在那个工作目录下另行配置，或把 session working directory 指回仓库根。

## 使用方式

Firecrawl MCP 工具会以 `mcp__firecrawl__...` 命名空间挂载，并默认走 MCP 工具审批。模型应优先通过 `.agents/skills/firecrawl/SKILL.md` 判断工具选择：

- 已知单页：scrape
- 开放搜索：search
- 站内 URL 发现：map
- 多个已知 URL：batch scrape
- 多页覆盖：crawl，并限制范围
- 结构化字段：extract
- 交互页面：browser tools

如果 MCP 没有成功挂载，先看 trace 里的 `mcp_loaded` 诊断；不要退回已经移除的 `web_search` / `web_fetch`。

## 事实源

- MCP 配置：`.agents/.config.toml`
- Firecrawl 使用指导：`.agents/skills/firecrawl/SKILL.md`
- MCP 配置解析：`packages/agent/src/mcp/config-loader.ts`
- MCP 工具挂载：`packages/agent/src/mcp/client-manager.ts`
- runtime 装配：`apps/api/src/index.ts`、`apps/worker/src/index.ts`
