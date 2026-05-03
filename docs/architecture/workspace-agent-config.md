# 工作区运行配置

## 当前用途边界

工作区级 agent 输入来自当前 `session.workingDirectory`，`apps/api` 和 `apps/worker` 都会读取同一份工作区输入：

- `AGENTS.md`：给本轮 prompt 提供工作区根指令
- `.agents/skills/`：给 runtime 提供 workspace skill metadata，并作为 `search_skill` / `load_skill` 的只读来源
- `.agents/.config.toml`：给 runtime 提供 workspace MCP server 配置
- `.agents/plans/`：承载 session 级 task brief artifact

其中 `AGENTS.md`、`.agents/skills/` 和 `.agents/.config.toml` 是运行时输入；`.agents/plans/` 是运行时产物与用户可编辑 artifact。

配置与指令输入不进入数据库，也不和 user settings 做 merge；`task brief` 绑定路径会进入 session state，但文件正文仍以工作区里的 markdown 为事实源。

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

## `.agents/.config.toml`

第一版只认当前工作目录下这一个文件：

```text
<workingDirectory>/
  .agents/
    .config.toml
```

不做：

- 向父目录递归查找
- 多文件 merge
- 和 user settings / session settings 混合解析

### 协议

顶层采用 Codex 风格的 `[mcp_servers.<name>]`：

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

## 运行时装配

- API 和 worker 在各自的 runtime 创建前读取 `.agents/.config.toml`
- 启用且连接成功的 MCP server 会把未禁用的子工具挂进本次 `ToolRegistry`
- MCP tool 统一命名为 `mcp__<server>__<tool>`
- MCP tool 默认走 `always-ask-user`
- `YOLO mode` 不绕过 MCP 工具审批

这意味着 MCP 连接是“按次装配”的运行时上下文，而不是持久化 session 状态。

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
- prompt 不额外注入 MCP 长文案；模型只通过 mounted tools 感知可用 MCP 工具

## 当前事实源

- 配置解析：`packages/agent/src/mcp/config-loader.ts`
- MCP 连接与工具挂载：`packages/agent/src/mcp/client-manager.ts`
- API / worker 装配：`apps/api/src/index.ts`、`apps/worker/src/index.ts`
- workspace instructions：`packages/agent/src/workspace-instructions/`
- trace 事件结构：`packages/agent/src/trace.ts`
