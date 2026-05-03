---
name: firecrawl
description: Use this skill when a task needs public web search, webpage scraping, crawling, URL discovery, or structured extraction through Firecrawl.
---

# Firecrawl

Use Firecrawl for public web work in this workspace. The built-in `web_search` and `web_fetch` tools are intentionally not available; Firecrawl is mounted through workspace MCP when `.agents/.config.toml` loads successfully.

## First checks

1. Check the mounted tools list for Firecrawl MCP tools. Their names are namespaced with `mcp__firecrawl__...`.
2. If Firecrawl tools are not mounted, tell the user the workspace MCP server did not load and check the `mcp_loaded` trace diagnostics.
3. Do not ask the user for the API key in normal use. The runtime passes `FIRECRAWL_API_KEY` from the process environment.

## Tool choice

- Use `firecrawl_search` for open-ended web discovery.
- Use `firecrawl_scrape` when the exact page URL is known.
- Use `firecrawl_map` to discover URLs on a site before selecting pages to scrape.
- Use `firecrawl_batch_scrape` for several known URLs.
- Use `firecrawl_crawl` only when the task truly needs multi-page coverage, and keep limits small.
- Use `firecrawl_extract` when the user wants structured fields from pages.
- Use Firecrawl browser tools only for interactive pages that require navigation, clicking, or stateful browser automation.

## Output discipline

1. Prefer JSON extraction or focused scraping over full-page markdown when the user needs specific facts.
2. Keep search limits small by default, usually 5 to 10 results.
3. For crawl and agent-style research, mention that the job can be asynchronous and may need status polling.
4. Cite the source URLs you used in the final answer when answering from web results.

## CLI fallback

If MCP is unavailable but shell access is appropriate, use the Firecrawl CLI through `npx -y firecrawl-cli` with the existing `FIRECRAWL_API_KEY` environment variable. Prefer MCP for normal agent runs because tool calls are structured and traceable.
