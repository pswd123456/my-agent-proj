---
name: hooks_config
description: Configure workspace hooks in .agents/config.toml by editing [hooks.<id>] sections, preserving MCP servers, following event/behavior/wait_mode rules, validating with the workspace hook loader, and checking runtime diagnostics.
---

# Hooks Config

Use this skill when the user asks to add, update, disable, remove, inspect, or debug workspace hooks configured in `.agents/config.toml`.

## Boundaries

- Workspace hooks live in `.agents/config.toml` under `[hooks.<id>]`.
- The same file may also contain `[mcp_servers.<name>]`; preserve unrelated MCP servers and other non-hook sections.
- Workspace hooks are per-run workspace inputs. They are not copied into `agent_settings`, and changes apply on the next runtime creation.
- Workspace hooks are merged before user settings hooks and then normalized with the same `normalizeUserContextHooks(...)` rules.
- Do not add UI, database fields, migrations, or new hook runtime behavior unless the user explicitly asks.

## Workflow

1. Read `docs/architecture/workspace-agent-config.md` before editing the config shape.
2. Inspect the current `.agents/config.toml` and preserve unrelated sections.
3. Choose a stable hook id for `[hooks.<id>]`; keep it short, lowercase, and responsibility-oriented.
4. Set `event`, `behavior`, `content`, and optionally `title`, `enabled`, `wait_mode`, or `max_turns`.
5. Prefer editing only the relevant hook section. Do not rewrite the whole config unless needed.
6. Validate the hook config with the repo loader.

## Hook Fields

Required:

- `event`: `session_started`, `run_started`, or `run_end`
- `content`: non-empty string

Optional:

- `behavior`: `context`, `message`, or `subagent`
- `title`: display/debug title; defaults to the hook id
- `enabled`: boolean; defaults to `true`
- `wait_mode`: only for `subagent`; `blocking` or `unblocking`
- `max_turns`: only for `subagent`; normalized to the session limit

If `behavior` is omitted, `run_end` defaults to `message`; other events default to `context`.

## Behavior Rules

- `context` supports only `session_started` and `run_started`.
- `message` supports `session_started`, `run_started`, and `run_end`.
- `subagent` supports all three events.
- `run_end` subagent hooks are always normalized to `wait_mode = "unblocking"`.
- Only the first enabled hook for each `behavior:event` type runs; workspace hooks are ordered before user settings hooks.
- Hook content stays out of the stable prompt prefix and cache key.

## Example

```toml
[hooks.repo_context]
event = "run_started"
behavior = "context"
title = "Repo context"
content = "先读取本仓库约定和当前任务相关上下文。"

[hooks.wrap_up]
event = "run_end"
behavior = "subagent"
wait_mode = "unblocking"
max_turns = 40
title = "Wrap up"
content = "当前 run 结束后整理可复用的后续上下文。"
```

## Validation

Parse workspace hooks:

```bash
bun -e 'import { loadWorkspaceHookConfig } from "./packages/agent/src/workspace-hooks/index.ts"; const result = await loadWorkspaceHookConfig(process.cwd()); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
```

If the same edit touched MCP sections, also parse MCP config:

```bash
bun -e 'import { loadWorkspaceMcpConfig } from "./packages/agent/src/mcp/index.ts"; const result = await loadWorkspaceMcpConfig(process.cwd(), { resolveEnvironment: false }); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
```

Verify this skill is discoverable:

```bash
bun -e 'import { discoverWorkspaceSkills } from "./packages/agent/src/skills/index.ts"; const result = await discoverWorkspaceSkills(process.cwd()); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
```

On the next agent run, hook config diagnostics appear in the `runtime` system log as `workspace_hooks_config_diagnostics`.

## Reply Checklist

- Name the `[hooks.<id>]` sections changed.
- State the selected `event`, `behavior`, and whether the hook is enabled.
- State which validation commands passed.
- If validation fails, report the loader diagnostic instead of guessing.
