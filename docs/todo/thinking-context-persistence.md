# Thinking Context Persistence

更新时间：2026-04-25
状态：已落地
范围：`packages/agent` runtime response handling / session messages / prompt replay / trace

## 落地记录

2026-04-25 已按本文第一版方案落地：

- 新增 `assistant thinking` conversation block，并在 prompt replay 中序列化为 Anthropic-compatible `type="thinking"` block
- runtime 仅在原生 `tool_use` response 中持久化带签名的 thinking；text-tool-call fallback 与 final `end_turn` thinking 不持久化
- file/memory snapshot 校验与 PostgreSQL session message 序列化支持 `assistant_thinking`
- compact summary 不输出完整 thinking 或 signature，tail 中未 compact 的 thinking 仍按原始 protocol block 回放
- 已补 prompt/session/runtime 测试，并通过 agent typecheck 与 build

验证命令：

```bash
bun test packages/agent/tests/prompt-skills.test.ts packages/agent/tests/postgres-session-manager.test.ts packages/agent/tests/thinking-context-persistence.test.ts packages/agent/tests/text-tool-call-fallback.test.ts packages/agent/tests/streaming-runtime.test.ts
bun --filter @ai-app-template/agent typecheck
bun --filter @ai-app-template/agent build
```

## 背景

最近几条本地 trace 显示，MiniMax Anthropic-compatible response 几乎每轮都会返回 `thinking` block，但当前 runtime 只把它写入 trace，不写入 `session.messages`。

当前链路：

- `packages/agent/src/runtime/run-loop.ts`：`extractThinkingBlocks(responseBlocks)` 只发 `thinking` trace event
- `packages/agent/src/runtime/run-loop.ts`：只有 `text` block 会通过 `buildAssistantBlockContent(...)` 进入 session
- `packages/agent/src/types.ts`：`ConversationBlock` 没有 thinking 类型
- `packages/agent/src/prompt.ts`：`toAnthropicMessages()` 只能回放 user / assistant text / tool call / tool result

结果是：模型在上一轮 `thinking` 中形成的阶段性判断，下一轮 prompt 看不到。工具轮次尤其明显，因为最近 trace 中大量 response 是 `thinking + tool_use`，没有可见 text；这些轮次的工作记忆目前完全留在 trace，而不是 context。

## 调研结论

### 1. Anthropic 官方要求 tool-use loop 保留 thinking block

Anthropic extended thinking 文档明确写到：extended thinking 可与 tool use 一起使用；使用 tool use 时，必须把上一条 assistant message 的完整、未修改 `thinking` block 回传 API，以保持 reasoning continuity。

文档还说明：

- `thinking` 在 streaming 中以 `thinking_delta` 输出，签名通过 `signature_delta` 在 block 结束前给出
- `signature` 是 opaque field，用于校验 thinking block 是由模型生成的
- 使用 tool use 时，thinking blocks 必须显式保留并随 tool results 一起返回
- 如果回传 thinking blocks，推荐原样回传，避免潜在问题

参考：

- https://platform.claude.com/docs/en/build-with-claude/extended-thinking#extended-thinking-with-tool-use
- https://platform.claude.com/docs/en/build-with-claude/extended-thinking#thinking-encryption

### 2. MiniMax 文档支持 messages 中的 thinking，但参数说明存在冲突

MiniMax Anthropic API 兼容文档在兼容性表格里写明：

- `messages` 部分支持，支持文本和工具调用
- `type="thinking"` 完全支持
- `thinking` 参数在支持参数表中标为完全支持

但同页注意事项又写到部分 Anthropic 参数，如 `thinking`，会被忽略。

因此不能只依赖文档判断。当前实现应以真实 smoke 结果作为落地前门槛，并把 provider 行为记录在测试或 trace 中。

参考：

- https://platform.minimaxi.com/docs/api-reference/text-anthropic-api

### 3. 本地 provider smoke 已验证完整 response.content 回放可用

用当前 `.env` 中的 provider 配置做了两步 smoke：

1. 第一轮请求挂载一个测试 tool，并强制模型调用该 tool
2. 第二轮把第一轮完整 `response.content` 作为 assistant message 回传，再追加 `tool_result`

结果：

- baseURL：`https://api.minimaxi.com/anthropic`
- model：`MiniMax-M2.7`
- 第一轮 content types：`thinking`, `tool_use`
- 第一轮 `thinking` 带 `signature`
- 第二轮回放完整 content 后 provider 正常接受
- 第二轮 content types：`thinking`, `text`
- 第二轮 stop reason：`end_turn`

这说明当前 MiniMax Anthropic-compatible 路径至少接受“原样 thinking + tool_use + tool_result”的历史回放。

## 本次决策

落地 thinking context persistence，但按 provider 协议保留为结构化 thinking block，不把它拼进普通 assistant 文本。

核心原则：

- `thinking` 是模型可见的上一轮 reasoning state，不只是 UI trace
- 保存时保留原始 `thinking` 与 `signature`
- 回放时仍作为 assistant content 中的 `type="thinking"` block
- `thinking` 必须出现在同一 assistant message 的 `text` / `tool_use` 之前
- 不修改、摘要或重签原始 `thinking` block 后再作为 protocol thinking 回放

## 实施方案

### 1. 扩展 conversation block 类型

在 `packages/agent/src/types.ts` 增加：

```ts
export interface AssistantThinkingConversationBlock extends BaseConversationBlock {
  kind: "assistant thinking";
  content: string;
  signature: string;
}
```

并加入 `ConversationBlock` union。

命名选择：

- 使用 `assistant thinking`，保持 block kind 与现有 `assistant` / `tool call` / `tool result` 风格一致
- 字段用 `content` 存可读 thinking 文本，避免在 session 层暴露 provider 字段名
- 字段用 `signature` 原样存 provider 签名

### 2. 增加 builder 和 extractor 对齐

在 `packages/agent/src/runtime/blocks.ts` 增加：

- `buildAssistantThinkingBlockContent({ text, signature })`
- 继续保留 `extractThinkingBlocks(...)`

`extractThinkingBlocks(...)` 不应丢弃 signature 为空的情况。如果 provider 可能返回空 signature，应在 builder 或 append 处决定是否持久化；当前 MiniMax smoke 中 signature 存在。

### 3. runtime 写入 session

在 `packages/agent/src/runtime/run-loop.ts` 中，处理 response 后：

1. 先 emit `response`
2. 对每个 thinking block emit `thinking` trace event
3. 对满足持久化条件的 thinking block append 到 `session.messages`
4. 再 append text block
5. 再执行 tool call append / execution

第一版持久化条件：

- 只在 response 含真实 `tool_use` 时持久化 `thinking`
- text-tool-call fallback 的 `[TOOL_CALL]...[/TOOL_CALL]` 不持久化 thinking，先避免把非原生 provider tool protocol 混入 signed thinking 语义
- final `end_turn` 的 thinking 第一版不持久化，避免未来多轮普通聊天无界增长

这样覆盖当前 trace 中最有价值的场景：`thinking + tool_use` 且下一轮需要理解上一轮工具选择依据。

### 4. prompt 回放支持 thinking

在 `packages/agent/src/prompt.ts` 的 `toAnthropicMessages()` 中：

- `assistant thinking` block 追加为 assistant content：

```ts
{
  type: "thinking",
  thinking: block.content,
  signature: block.signature
}
```

- 与连续 `assistant` text / `tool call` block 合并在同一个 assistant message
- 保持 block 顺序，不跨 user / tool result 合并

预期回放形态：

```text
user: 用户问题
assistant: thinking, text?, tool_use
user: tool_result
assistant: thinking, text?, tool_use
user: tool_result
```

### 5. session 持久化支持

File session：

- 更新 `packages/agent/src/session/shared.ts` 的 `isConversationBlock(...)`
- file-backed snapshot 无需 schema migration，但要保证旧 snapshot 仍可读

Postgres session：

当前 `session_messages` 表结构没有 thinking 专用列。第一版不新增列，复用现有字段：

- `role = "assistant_thinking"`
- `content = thinking text`
- `input_json = { "signature": "..." }`
- 其他 tool 字段为 null

需要修改：

- `packages/agent/src/session/postgres-session-manager.ts`
  - `toConversationBlock(...)`
  - `serializeBlock(...)`
- 如有 role 校验或测试 fixture，同步更新

不为第一版新增数据库 migration。原因是：

- `session_messages.role` 是 text，不需要枚举迁移
- `input_json` 已存在，可承载 signature
- 第一版先验证 protocol 与 runtime 行为，避免为单字段提前扩大 schema 面

如果后续需要查询 thinking 或做审计筛选，再考虑新增 `signature` / `block_type` 专用列。

### 6. compact 与 summary

`compactHistoryBlocks(...)` 的 tail 保留逻辑可以继续工作，因为它按 block 数保留最近历史。

需要补充：

- `summarizeCompactedBlock(...)` 遇到 `assistant thinking` 时，不输出完整 thinking
- summary 使用短提示，例如：

```text
assistant thinking: preserved reasoning for a prior tool-use turn; signature omitted from compact summary
```

原因：

- compact summary 是 synthetic user block，不再是 provider-signed thinking
- 不应把签名 thinking 的文本摘要伪装成 protocol thinking
- 旧 thinking 被 compact 后，provider protocol continuity 已经不再保留，只保留人类可读历史摘要

### 7. trace 可观测性

现有 `thinking` trace event 保留。

新增验证点：

- `prompt` trace event 的 `messages` 中能看到 assistant content 里的 `thinking`
- `response` trace event 继续保留 provider 原始 content
- `thinking` trace event 继续用于 UI / timeline

第一版不新增 trace event 类型。

## 测试计划

### 单元测试

新增或扩展 `packages/agent/tests/prompt-skills.test.ts`：

- `toAnthropicMessages()` 能把 `assistant thinking + tool call` 序列化为同一个 assistant message
- `thinking` 出现在 `tool_use` 前
- `tool_result.tool_use_id` 仍能匹配前面的 `tool_use.id`
- compact 后 tail 中的 thinking 仍按原始 block 回放
- compact summary 中不包含完整 signature

新增或扩展 session 测试：

- `isConversationBlock(...)` 接受 `assistant thinking`
- memory / file session 能保存和恢复 thinking block
- Postgres serialize / deserialize 能 round-trip `role="assistant_thinking"` 和 signature

### runtime 测试

新增 runtime 测试：

- mock client 第一轮返回 `thinking + tool_use`
- tool result 后第二轮请求的 `messages` 包含上一轮 `thinking`
- final session messages 包含 `assistant thinking`, `tool call`, `tool result`
- final `end_turn` thinking 默认不持久化

Streaming 测试：

- 当前 `streamAnthropicMessage(...)` 只流式 emit text delta，不 emit thinking delta
- 第一版可以保持 streaming UI 行为不变，只依赖 `finalMessage()` 中的完整 thinking block 持久化
- 如 provider finalMessage 缺失 thinking signature，则测试应失败并暴露 provider 兼容问题

### Provider smoke

保留一个手动 smoke 步骤，落地后再跑：

1. 启动一个 session，挂载 workspace tool
2. 触发 `thinking + tool_use`
3. 检查下一轮 `prompt` trace 中 assistant message 包含 `thinking`
4. 确认 MiniMax 没有返回 provider 400
5. 确认最终回答完成

建议记录 smoke session id 到对应 PR 或后续 todo 更新中。

## 验收标准

完成后应满足：

1. `thinking + tool_use` response 的 thinking 会进入 `session.messages`
2. 下一轮 provider request 会原样回放 `thinking` block 与 `signature`
3. `thinking` 不被拼入普通 assistant text
4. `tool_use` / `tool_result` 配对不受影响
5. compact summary 不伪造 signed thinking
6. file-backed 和 Postgres-backed session 都能恢复 thinking block
7. trace 中可以直接验证 prompt messages 包含 thinking
8. MiniMax Anthropic-compatible smoke 通过

## 非目标

- 不把 final answer 前的所有 thinking 都持久化到普通多轮对话
- 不把 thinking 写入 `runtimeContextMessages`
- 不修改 prompt cache key
- 不新增 full compact
- 不新增 thinking 的 UI 展示策略
- 不引入 provider 抽象层重构
- 不为第一版新增数据库 migration

## 风险与回滚

### Provider 接受度

风险：MiniMax 文档对 `thinking` 参数说明有冲突，后续模型或兼容层可能改变行为。

缓解：

- 第一版只持久化 provider 原生返回的 signed thinking
- 落地前后都跑 smoke
- 如 provider 400，使用 feature flag 临时关闭 thinking persistence

建议 feature flag：

```text
PERSIST_ASSISTANT_THINKING=true
```

默认值建议：

- 本地开发：true
- 若生产化前缺少 provider 覆盖：false 或按 provider allowlist 开启

### Context 增长

风险：thinking block 会增加 session history 规模。

缓解：

- 第一版只持久化 tool-use 轮次 thinking
- final end_turn thinking 不持久化
- history compact 超阈值后仍会压缩旧 block
- 后续可按 provider token 统计评估是否需要更细粒度策略

### 签名完整性

风险：修改、截断或摘要 thinking 后仍按 protocol thinking 回放，可能导致 provider 校验失败。

缓解：

- protocol thinking 只能原样保存和原样回放
- compact summary 只能作为普通 text summary，不保留 signature
- 测试中断言回放 block 与原始 provider block 一致

## 建议落地顺序

1. 加类型与 builder：`types.ts`、`runtime/blocks.ts`
2. 加 prompt serialization：`prompt.ts`
3. 加 session validator 与 persistence：`session/shared.ts`、`session/postgres-session-manager.ts`
4. 加 runtime append：`runtime/run-loop.ts`
5. 加测试：prompt / session / runtime
6. 跑 `bun test packages/agent/tests/...`
7. 跑 provider smoke，检查 trace
8. 视测试结果决定是否默认开启 feature flag
