# 工作区 `.agent/` 运行配置

## 当前用途边界

工作区级 agent 配置统一来自当前 `session.workingDirectory` 下的 `.agent/` 目录，但不同子路径承担不同职责：

- `.agent/skills/`：给 runtime 提供 workspace skill metadata
- `.agent/.config.toml`：给 runtime 提供 workspace MCP server 配置
- `.agent/plans/`：承载 session 级 task brief artifact

其中前两条是运行时配置输入；`.agent/plans/` 是运行时产物与用户可编辑 artifact。

配置输入不进入数据库，也不和 user settings 做 merge；`task brief` 绑定路径会进入 session state，但文件正文仍以工作区里的 markdown 为事实源。

如果想看 MCP 从配置读取到工具挂载、权限与 trace 的完整链路，继续读 `docs/architecture/mcp-module.md`。

## `.agent/skills/`

- runtime 每次执行前扫描 `workingDirectory/.agent/skills/`
- 当前只读取 skill metadata，不执行 skill 文件中的脚本
- skill 列表进入 prompt 的 `runtimeContextMessages`

更细规则见 `docs/plan/stage3.md` 和 `packages/agent/src/skills/`

## `.agent/.config.toml`

第一版只认当前工作目录下这一个文件：

```text
<workingDirectory>/
  .agent/
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

transport 通过字段推断：

- 有 `command` => `stdio`
- 有 `url` => `http`

如果字段缺失、类型不对、同名 server 重复或 TOML 非法：

- 只跳过对应 server（或整个非法文件）
- 诊断进入 trace / log
- 不阻断内置工具运行

## 运行时装配

- API 在每次 `execute` / `execute/stream` 前读取 `.agent/.config.toml`
- 连接成功的 MCP server 会把工具挂进本次 `ToolRegistry`
- MCP tool 统一命名为 `mcp__<server>__<tool>`
- MCP tool 默认走 `always-ask-user`
- `YOLO mode` 不绕过 MCP 工具审批

这意味着 MCP 连接是“按次装配”的运行时上下文，而不是持久化 session 状态。

## `.agent/plans/`

当前只有 `plan mode` 会使用这个目录。

- 每个 session 绑定一个 brief 文件：`.agent/plans/<sessionId>/<planName>.md`
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
- API 装配：`apps/api/src/index.ts`
- trace 事件结构：`packages/agent/src/trace.ts`
