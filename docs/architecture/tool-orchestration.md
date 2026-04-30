# Tool 编排与执行边界

## 定位

这一层负责把模型返回的 `tool_use` 转成可恢复、可审批、可追踪的 runtime 动作。

它不决定某个工具的业务语义，也不替代 capability pack。工具自己的输入 schema、权限摘要、sandbox 目标和执行逻辑仍然放在 `packages/agent/src/tools/`；runtime 编排层只负责这些工具在一次 agent turn 中如何被准备、执行、持久化和恢复。

## 主链路

当前主链路分成四步：

1. `run-loop.ts` 从模型响应里解析 tool calls，并把同轮 tool calls 先写成 `tool call` block
2. `prepareToolAction()` 做工具查找、输入校验、执行上下文创建、权限 / sandbox preflight，以及并发安全性判断
3. ready 的工具执行 `execute()`，产出 `ToolActionCompletion`
4. `persistToolActionCompletion()` 追加 `tool result` block，更新 `lastError`，并写入 trace / SSE event

这种拆分让工具执行和结果持久化解耦：runtime 可以先判断哪些工具能一起跑，再按原始 tool call 顺序把结果写回 session。

## 并发边界

当前 runtime 只会并发执行连续的一段并发安全工具。

并发安全性的默认规则是：

- 如果工具实现了 `isConcurrencySafe(input, context)`，以它的返回值为准
- 否则默认使用 `tool.isReadOnly`
- 只要遇到需要权限、人类输入、未知工具、校验错误，或并发不安全工具，就停止当前并发批次

这意味着多个连续只读查询可以并行，例如 `read_file`、`search_text`、`git_diff`、LSP 查询等默认只读工具；而写文件、删除路径、shell、网络请求、delegation、日程写入、todo 写入等默认保持串行边界。

并发只发生在工具真实执行阶段。结果持久化仍按模型返回的 tool call 顺序进行，所以 `session.messages`、`toolOutputs` 和 trace 的可读顺序不会因为并行执行而乱掉。

## 权限与等待态

权限检查属于 prepare 阶段，而不是工具执行阶段。

当前检查顺序里会覆盖这些边界：

- plan mode 下阻断 workspace 文件写入与 todo 写入工具
- workspace-rooted 工具先做 realpath / symlink escape preflight
- workspace 外路径需要一次 session 级审批
- YOLO mode 自动放行除 shell / network 之外的工具
- shell allow / deny、tool allow / ask / deny 按 session/user settings 生效
- `destructive-only` 和 `always-ask-user` 工具按各自 profile 进入审批

如果进入 `ask_user`，runtime 会保留已经写入的 `tool call`，设置 `pendingPermissionRequest` 与 `pendingToolCallIds`，并结束当前 run 到等待输入状态。用户批准后，runtime 复用原来的 pending tool call，不重复追加新的 tool call block，只追加最终 tool result。

## Tool 契约字段

`RuntimeTool` 当前必须声明：

- `family`：工具所属能力族，用于 prompt 暴露、权限配置和 UI 归类
- `isReadOnly`：默认并发安全判断，也用于 plan mode 等限制
- `hasExternalSideEffect`：提示工具是否有外部副作用
- `permissionProfile`：`allow`、`destructive-only` 或 `always-ask-user`
- `sandboxProfile`：`none`、`workspace-rooted` 或 `workspace-working-directory`
- `validate()`：把模型输入归一化成工具真实执行输入
- `execute()`：执行工具并返回模型可见内容、展示文本和可选 structured details

可选字段：

- `getSandboxTargets()`：给 workspace sandbox preflight 使用
- `getPermissionRequest()`：给审批弹窗和 pending request 提供更具体的人类可读摘要
- `isConcurrencySafe()`：覆盖只读默认值，用输入和上下文决定本次调用能否并发

## 与消息历史的关系

`session.messages` 仍是恢复事实源：

- `tool call` block 表示模型已经发起了这个工具请求
- `tool result` block 表示 runtime 已经完成或阻断了对应工具
- `pendingToolCallIds` 表示已有 tool call 还在等权限或结果

trace 用来复盘，不用来恢复 session。一次工具执行至少能从 trace 看到 `tool_call` 和 `tool_result`；权限等待还会看到 `permission_request`，权限阻断会看到 `permission_blocked` 与错误 tool result。

## 不做的事

- 不把并发安全扩大成任意工具乱序执行
- 不在并发批次里跨过写入、审批、等待人类输入或未知工具
- 不让工具自己直接写 session messages；工具只返回结果，持久化由 runtime 统一完成
- 不把 trace 当作 tool result 的恢复来源

## 推荐事实源

- runtime 主循环：`packages/agent/src/runtime/run-loop.ts`
- prepare / persist：`packages/agent/src/runtime/tool-execution.ts`
- 权限与 sandbox preflight：`packages/agent/src/runtime/permission-checker.ts`
- 工具契约：`packages/agent/src/tools/runtime-tool.ts`
- 工具注册：`packages/agent/src/tools/registry.ts`
- 并发回归测试：`packages/agent/tests/tool-orchestration.test.ts`
