# 内建 LSP Capability Pack

## 目标

- 第一版只覆盖 `TypeScript` / `JavaScript`
- 默认启用，但 `typescript-language-server` 只在实际调用 LSP 工具时才懒启动
- 不从零实现 language server；本仓库只负责 client、生命周期管理和工具输出适配

## 工具面

- `lsp_hover`
- `lsp_go_to_definition`
- `lsp_find_references`
- `lsp_document_symbols`
- `lsp_workspace_symbols`
- `lsp_diagnostics`

这些工具都是只读工具，统一属于 `family: "lsp"`。

## 运行方式

- 每个 working directory 对应一个 LSP manager
- 第一次调用相关工具时才启动 `typescript-language-server --stdio`
- manager 初始化时会发送 workspace root URI，并按需同步当前文件的 `didOpen` / `didChange`
- `dispose()` 时会走 `shutdown` / `exit`，超时后再终止子进程

## 输入与输出

- 文件型工具只接受工作区内的 TS/JS 文件
- 允许的扩展名是 `.ts`、`.tsx`、`.js`、`.jsx`、`.mts`、`.cts`、`.mjs`、`.cjs`
- 位置信息使用 `line` 1-based、`character` 0-based UTF-16 offset
- 输出统一使用 workspace-relative path、1-based range、preview 或 message
- 大结果会截断，空结果返回成功空数组，不当作失败

## 失败语义

- unsupported file / invalid position -> `INVALID_TOOL_INPUT`
- server 启动失败 -> `LSP_SERVER_UNAVAILABLE`
- request 超时 -> `LSP_REQUEST_TIMEOUT`

## 默认值与迁移

- `lsp` 现在是默认 capability pack 之一
- 当前默认 capability packs 是 `workspace`、`schedule`、`lsp`
- 新 session 和新 settings 会带上这个默认值
- 首次启用单租户 settings 时，会把旧默认 `agent_settings` 记录 seed 到 `~/.agents/config.toml`，但不会重写自定义组合

相关迁移见 `packages/db/migrations/0018_futuristic_black_bolt.sql`

## 实现入口

- LSP manager: `packages/agent/src/lsp/manager.ts`
- LSP tools: `packages/agent/src/tools/lsp.ts`
- registry 装配: `packages/agent/src/tools/registry.ts`
- API runtime: `apps/api/src/index.ts`
- worker runtime: `apps/worker/src/index.ts`
