---
name: channel_config
description: Configure workspace message channels in .agents/.config.toml, especially [channels.telegram] polling/webhook mode, preserving MCP servers and hooks, using env placeholders for secrets, validating with the channel config loader, and checking Telegram inbox status.
---

# Channel Config

Use this skill when the user asks to add, update, enable, disable, inspect, or debug workspace message channels configured in `.agents/.config.toml`.

## Boundaries

- Channel config lives in `.agents/.config.toml` under `[channels.<name>]`.
- The same file may also contain `[mcp_servers.<name>]` and `[hooks.<id>]`; preserve unrelated sections.
- Channel config is a workspace runtime input. It is not copied into `agent_settings`, and changes apply when API/runtime code reads the current default working directory config.
- Current implemented channel: `telegram`.
- Keep secrets out of the repo. Prefer env placeholders such as `$TELEGRAM_BOT_TOKEN`.
- Do not add database fields, migrations, new channel adapters, or UI changes unless the user explicitly asks.

## Workflow

1. Read `docs/architecture/workspace-agent-config.md` before changing the config shape.
2. Inspect the current `.agents/.config.toml` and preserve unrelated MCP and hook sections.
3. Add or update only the relevant `[channels.<name>]` section.
4. For Telegram, set `enabled`, `mode`, `bot_token`, optional `webhook_secret`, and optional `webhook_url`.
5. Validate with the channel config loader.
6. If the API is running and the user wants runtime confirmation, check `/inbox/telegram/status`.

## Telegram Fields

```toml
[channels.telegram]
enabled = true
mode = "polling"
bot_token = "$TELEGRAM_BOT_TOKEN"
```

Webhook mode is optional:

```toml
[channels.telegram]
enabled = true
mode = "webhook"
bot_token = "$TELEGRAM_BOT_TOKEN"
webhook_secret = "$TELEGRAM_WEBHOOK_SECRET"
webhook_url = "https://example.com/api/inbox/telegram/webhook"
```

- `enabled`: boolean. When false, Telegram webhook handling is treated as unconfigured.
- `mode`: `polling` or `webhook`. Default to `polling`; polling needs no public webhook URL.
- `bot_token`: Telegram bot token or `$ENV_NAME` / `${ENV_NAME}` reference.
- `webhook_secret`: optional Telegram webhook secret token or env reference.
- `webhook_url`: optional default webhook URL used only for webhook mode.

If `[channels.telegram]` is absent, API code falls back to process env `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.

## Validation

Parse channel config without resolving env placeholders:

```bash
bun -e 'import { readManageableWorkspaceChannelConfig } from "./packages/agent/src/channels/index.ts"; const result = await readManageableWorkspaceChannelConfig(process.cwd()); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
```

Parse runtime channel config with env resolution:

```bash
bun -e 'import { loadWorkspaceChannelConfig } from "./packages/agent/src/channels/index.ts"; const result = await loadWorkspaceChannelConfig(process.cwd()); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
```

If the same edit touched MCP or hook sections, also run their loaders:

```bash
bun -e 'import { loadWorkspaceMcpConfig } from "./packages/agent/src/mcp/index.ts"; const result = await loadWorkspaceMcpConfig(process.cwd(), { resolveEnvironment: false }); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
bun -e 'import { loadWorkspaceHookConfig } from "./packages/agent/src/workspace-hooks/index.ts"; const result = await loadWorkspaceHookConfig(process.cwd()); console.log(JSON.stringify(result, null, 2)); if (result.diagnostics.length) process.exit(1);'
```

Verify this skill is discoverable:

```bash
bun -e 'import { discoverWorkspaceSkills } from "./packages/agent/src/skills/index.ts"; const result = await discoverWorkspaceSkills(process.cwd()); console.log(JSON.stringify(result.skills.map((skill) => skill.name), null, 2)); if (result.diagnostics.length) process.exit(1);'
```

## Reply Checklist

- Name the `[channels.<name>]` sections changed.
- State whether secrets were stored as env placeholders or direct values.
- State which validation commands passed.
- If validation fails, report the loader diagnostic instead of guessing.
