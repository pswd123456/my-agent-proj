---
name: install_mcp
description: Install or update workspace MCP servers by editing .agents/.config.toml, preserving existing servers, using Codex-style [mcp_servers.<name>] stdio/http config, validating with the repo MCP loader, and checking mcp_loaded diagnostics on the next run.
---

# Install MCP

Use this skill when the user asks to install, add, configure, enable, disable, or debug a workspace MCP server.

## Boundaries

- Workspace MCP config lives at `.agents/.config.toml`; the same file may also contain non-MCP sections such as `[hooks.<id>]`.
- MCP is a per-run workspace tool layer, not a persisted plugin system or database setting.
- Changes apply on the next runtime creation; do not assume tools hot-reload into the current run.
- MCP tools are mounted as `mcp__<server>__<tool>` and default to approval-required execution.
- Do not add UI, database, capability-pack, or native-tool changes unless the user explicitly asks.

## Workflow

1. Read `docs/architecture/workspace-agent-config.md` and `docs/architecture/mcp-module.md` when the exact MCP contract matters.
2. Inspect the current `.agents/.config.toml` before editing and preserve unrelated servers and non-MCP sections.
3. Use official docs or the package README for the requested MCP server's exact command, args, URL, headers, env vars, and tool-disable names. Do not invent server-specific fields.
4. Add or update only the relevant `[mcp_servers.<name>]` section.
5. For `stdio`, use `command`, optional `args`, optional `env`, optional `disabled_tools`, and optional `enabled`.
6. For `http`, use absolute `url`, optional `headers`, optional `disabled_tools`, and optional `enabled`.
7. Keep secrets out of the repo. Prefer env placeholders such as `$FIRECRAWL_API_KEY` in `env` or `headers`.

## Validation

After editing `.agents/.config.toml`, parse it with the repo loader:

```bash
bun -e 'import { loadWorkspaceMcpConfig } from "./packages/agent/src/mcp/index.ts"; const result = await loadWorkspaceMcpConfig(process.cwd(), { resolveEnvironment: false }); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
```

If the server command, env, and network are available, also test real mounting:

```bash
bun -e 'import { loadWorkspaceMcpTools } from "./packages/agent/src/mcp/index.ts"; const result = await loadWorkspaceMcpTools(process.cwd()); console.log(JSON.stringify({ configPath: result.configPath, foundConfig: result.foundConfig, diagnostics: result.diagnostics, servers: result.servers }, null, 2)); await result.dispose(); if (result.diagnostics.length || result.servers.some((server) => server.status === "failed")) process.exit(1);'
```

On the next agent run, check trace/log diagnostics for `mcp_loaded` if tools do not appear in the mounted tool list.

## Reply Checklist

- Say which `[mcp_servers.<name>]` section changed.
- State whether validation only parsed config or also mounted the server.
- Mention any required environment variables that are still expected outside the repo.
- If mounting fails, report the loader or `mcp_loaded` diagnostic rather than guessing.
