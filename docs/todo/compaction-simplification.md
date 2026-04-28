# Compaction Simplification

更新时间：2026-04-25
状态：已落地
范围：`packages/agent` runtime prompt / tool-result context 治理

## 背景

落地前 runtime 同时存在两类上下文压缩：

1. `history compact`
   - 在 `packages/agent/src/prompt.ts`
   - 当时触发阈值是 `contextWindow * 0.6`；当前实现已调整为 `contextWindow * 0.95`，并作为 full compaction 前的第一阶段压缩

2. `tool output compaction`
   - 在 `packages/agent/src/runtime/tool-output-compaction.ts`
   - 在 tool 执行完成后、写入 `session.messages` 之前，对单条 tool result 做统一 head/tail 截断

落地判断：第二类统一 `tool output compaction` 不应继续保留。

原因不是“永远不需要处理大 tool 输出”，而是：

- 它在 runtime 层统一按字符做机械截断，不理解工具语义
- 它会在写入 `session.messages` 之前就丢失中段信息，后续轮次无法再从 session 恢复
- 不同工具的输出结构差异很大，统一 head/tail 截断不是稳定策略
- 后续更合理的方向是：工具内部按各自特性单独处理，或再单独设计 full compact

## 本次决策

### 1. 废除统一的 tool output compaction

本仓库不再保留“runtime 层统一截断单条 tool result”的机制。

具体含义：

- `executeToolAction()` 写入 `session.messages` 时，直接写入工具返回内容
- runtime 不再调用统一的 `compactToolResultForContext()`
- 删除 `packages/agent/src/runtime/tool-output-compaction.ts`

### 2. 保留 history compact

当前 `history compact` 保留，作为第一阶段上下文压缩机制。

保留范围：

- `estimatePromptTokens(...) > Math.floor(session.contextWindow * 0.95)` 的触发条件
- `compactHistoryBlocks(...)` 的 synthetic summary user block 机制
- 最近 tail 保留策略

### 3. full compaction 已在后续单独落地

这次落地当时不新增第二套 compact runtime；后续已经通过 `docs/plan/full-compaction.md` 单独落地 runtime 级 full compaction。

当前边界：

- 不恢复旧的 tool-result-level 统一截断
- full compaction 写入 `session.context.fullCompactionState`
- full compaction summary 通过 `runtimeContextMessages` 注入，不进入 stable prefix / cache key
- 具体触发与恢复边界以 `docs/architecture/context-management/compaction.md` 和 `docs/plan/full-compaction.md` 为准

### 4. 后续允许的方向

后续如果继续治理大 tool 输出，只走下面两条路径之一：

1. 工具内部按语义单独处理
   - 例如 `read_file` 只返回请求行窗
   - 例如 `grep` / `search_text` 只返回命中片段
   - 例如 `shell` 优先保留 stderr / 最后错误段

2. 继续演进 full compaction
   - 独立于 tool-result-level 统一截断
   - 单独定义触发条件、持久化策略、恢复边界和可观测性
   - 不能以“顺手扩展当前 tool-output-compaction”方式演进

## 实施边界

这份 todo 的实现要求如下。

### 必做

- 从 `packages/agent/src/runtime/tool-execution.ts` 移除对 `compactToolResultForContext` 的调用
- 删除 `packages/agent/src/runtime/tool-output-compaction.ts`
- 确保 tool result trace 仍然记录完整输出
- 确保 `session.messages` 中保存的是工具原始返回内容，而不是 runtime 统一截断后的内容
- 保留 `packages/agent/src/prompt.ts` 中现有 `history compact`

### 同步更新

- 更新所有把当前实现描述为“已落地 tool output compaction”的文档
- 更新相关测试，使其不再依赖 runtime 层统一截断单条 tool 输出
- 如果现有测试直接断言 compaction 提示文案，需要删除或改写

### 不做

- 不恢复旧的 `history compact` 低阈值
- 不把 full compaction 和旧 tool output compaction 混为一套机制
- 不顺手引入 trace 附件、外部文件引用、tool-result placeholder
- 不因为这个变更去做 prompt builder 或 session schema 重构

## 验收标准

完成后应满足：

1. 执行任意工具后，`session.messages` 中对应的 `tool result` 为工具原始返回内容
2. runtime 层不存在统一 `tool result` head/tail 截断逻辑
3. 当历史过长时，仍然只会由 `history compact` 参与 prompt 压缩
4. 文档中不再把当前实现表述为“runtime 已落地 tool output compaction”
5. 为工具特化处理预留空间，但当前仓库默认行为不再统一裁剪单条 tool 输出

## 备注

这份文档记录的是明确方向，不是备选方案。

后续实现如果要重新引入统一的 tool-result-level compact，需要先单独写新文档说明：

- 为什么工具内处理不够
- 为什么 `history compact` 不够
- 新机制的触发条件、数据保真边界、session 持久化影响、trace 对齐方式
