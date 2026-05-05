# 工作区运行配置

## 当前用途边界

工作区级 agent 输入来自当前 `session.workingDirectory`，`apps/api` 和 `apps/worker` 都会读取同一份工作区输入：

- `AGENTS.md`：给本轮 prompt 提供工作区根指令
- `.agents/skills/`：给 runtime 提供 workspace skill metadata，并作为 `search_skill` / `load_skill` 的只读来源
- `.agents/config.toml`：给 runtime 提供 workspace 级 settings 覆盖、MCP server、channels 和 legacy hook section
- `.agents/plans/`：承载 session 级 task brief artifact

其中 `AGENTS.md`、`.agents/skills/` 和 `.agents/config.toml` 是运行时输入；`.agents/plans/` 是运行时产物与用户可编辑 artifact。

配置与指令输入不会复制进数据库；`task brief` 绑定路径会进入 session state，但文件正文仍以工作区里的 markdown 为事实源。当前统一 settings 的真相源是：

- 全局：`~/.agents/config.toml`
- 工作区：`<workingDirectory>/.agents/config.toml`

runtime 创建时先读全局，再读工作区，并按字段级 merge。workspace 里 legacy `[hooks.<id>]` 会先并入 workspace hooks，再排到全局 hooks 前面统一归一化。

如果想看 MCP 从配置读取到工具挂载、权限与 trace 的完整链路，继续读 `docs/architecture/mcp-module.md`。

## `AGENTS.md`

- runtime 每次执行前只读取 `workingDirectory/AGENTS.md`
- 当前不向父目录递归查找，也不合并更深层 `AGENTS.md`
- 读取到的正文会进入 `runtimeContextMessages`
- 读取失败只记录诊断，不阻断内置工具运行
- `AGENTS.md` 不进入 `prefixMessages` 或 `cacheKey`

事实源：`packages/agent/src/workspace-instructions/`

## `.agents/skills/`

- runtime 每次执行前扫描 `workingDirectory/.agents/skills/`
- 发现到的 skill metadata 会进入 prompt 的 `runtimeContextMessages`
- runtime 同时暴露 `search_skill` / `load_skill`，让模型按需检索和读取具体 `SKILL.md`
- workbench composer 中的 `#skill_name` 只是显式可见引用，不会把 skill 正文作为隐藏附件自动注入
- runtime 不执行 skill 文件中的脚本

更细规则见 `docs/plan/stage3.md` 和 `packages/agent/src/skills/`

## Workbench 可见引用

- workbench composer 中的 `@relative/path` 会按当前 session `workingDirectory` 解析为显式文件引用
- workbench composer 中的 `#skill_name` 会按当前 workspace skill 列表解析为显式 skill 引用
- 这两类引用都会保留在用户消息正文里，runtime 仍然只接收普通文本消息
- workbench 不会为这些引用额外创建隐藏消息元数据或预读附件上下文

## `.agents/config.toml`

第一版只认当前工作目录下这一个文件：

```text
<workingDirectory>/
  .agents/
    config.toml
```

不做：

- 向父目录递归查找
- 多级 workspace 级联 merge
- 把 workspace 配置写回数据库 settings 表

`[mcp_servers.*]`、`[channels.*]` 和 legacy `[hooks.*]` 仍然保留在这个文件里，但它们现在被视为统一 settings 的 workspace 覆盖分区，而不是“独立于 settings 的第二套运行时输入”。

### 协议

MCP 顶层采用 Codex 风格的 `[mcp_servers.<name>]`：

- `stdio` server：`command` / `args` / `env`
- `http` server：`url` / `headers`
- 通用字段：`enabled` 控制 server 是否连接和挂载，`disabled_tools` 按原始 MCP tool name 禁用子工具

transport 通过字段推断：

- 有 `command` => `stdio`
- 有 `url` => `http`

如果字段缺失、类型不对、同名 server 重复或 TOML 非法：

- 只跳过对应 server（或整个非法文件）
- 诊断进入 trace / log
- 不阻断内置工具运行

外部消息通道使用 `[channels.<name>]`。当前只支持 Telegram：

```toml
[channels.telegram]
enabled = true
mode = "polling"
bot_token = "$TELEGRAM_BOT_TOKEN"
```

Webhook 部署是可选模式：

```toml
[channels.telegram]
enabled = true
mode = "webhook"
bot_token = "$TELEGRAM_BOT_TOKEN"
webhook_secret = "$TELEGRAM_WEBHOOK_SECRET"
webhook_url = "https://example.com/api/inbox/telegram/webhook"
```

channel 字段：

- `enabled`：可选布尔值，控制该 channel 是否接收消息
- `mode`：可选，`polling` / `webhook`；默认 `polling`，不需要公网 URL
- `bot_token`：Telegram bot token；可直接写值，也可写 `$ENV_NAME` / `${ENV_NAME}` 环境变量引用
- `webhook_secret`：可选 webhook secret token，同样支持环境变量引用
- `webhook_url`：仅 webhook 模式需要；调用设置 webhook 接口时可省略 URL

这组配置由 Settings > Channels 页面读写，保存在当前全局默认工作目录下的 `.agents/config.toml`，不复制进数据库。

同一个文件也支持 `[hooks.<id>]`：

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

hook 字段：

- `event`：`session_started` / `run_started` / `run_end`
- `behavior`：可选，`context` / `message` / `subagent`；省略时沿用现有兼容规则，`run_end` 默认为 `message`，其他事件默认为 `context`
- `content`：必填非空字符串
- `title`：可选字符串，省略时使用 hook id
- `enabled`：可选布尔值，默认 `true`
- `wait_mode`：仅 `subagent` 支持，`blocking` / `unblocking`；`run_end` subagent 固定归一化为 `unblocking`
- `max_turns`：仅 `subagent` 支持，按 session 上限归一化

workspace hooks 使用同一套 `normalizeUserContextHooks(...)` 规则，因此每个 `behavior:event` 只会保留第一条 enabled hook。合并顺序是 workspace `[hooks.*]` 在前、全局 `user_context_hooks` 在后；同类型冲突时后续 hook 会被保留为 disabled，而不是绕过规则重复执行。

## 运行时装配

- API 和 worker 在各自的 runtime 创建前读取 global `~/.agents/config.toml`，再读取 workspace `.agents/config.toml`
- 启用且连接成功的 MCP server 会把未禁用的子工具挂进本次 `ToolRegistry`
- MCP tool 统一命名为 `mcp__<server>__<tool>`
- MCP tool 默认走 `always-ask-user`
- `YOLO mode` 不绕过 MCP 工具审批
- workspace hooks 会和全局 settings hooks 合并后传入 runtime，后续 context / message / subagent 行为仍走原有 hook runtime

这意味着 MCP 连接、channel 配置和 workspace hooks 都是“按次装配”的运行时上下文，而不是持久化 session 状态。

## `.agents/plans/`

当前只有 `plan mode` 会使用这个目录。

- 每个 session 绑定一个 brief 文件：`.agents/plans/<sessionId>/<planName>.md`
- `planName` 由 planning tool 首次写入时显式提供，文件名保持语义化
- 文件内容是 task brief markdown，供 runtime 注入 prompt，也供用户直接编辑
- runtime 不会在切换 plan mode 的瞬间自动写文件
- brief 更新通过专用 planning 工具完成，而不是复用普通工作区写工具

更细边界见 `docs/architecture/context-management/plan-mode.md`。

## 可观测性

- trace 会在每次执行前写入一条 `mcp_loaded`
- `mcp_loaded` 记录配置路径、是否找到配置文件、server 加载结果和配置诊断
- workspace hook 配置诊断会写入 `runtime` system log 的 `workspace_hooks_config_diagnostics`
- prompt 不额外注入 MCP 长文案；模型只通过 mounted tools 感知可用 MCP 工具

## 当前事实源

- MCP 配置解析：`packages/agent/src/mcp/config-loader.ts`
- workspace hook 配置解析：`packages/agent/src/workspace-hooks/config-loader.ts`
- MCP 连接与工具挂载：`packages/agent/src/mcp/client-manager.ts`
- API / worker 装配：`apps/api/src/index.ts`、`apps/worker/src/index.ts`
- workspace instructions：`packages/agent/src/workspace-instructions/`
- trace 事件结构：`packages/agent/src/trace.ts`
