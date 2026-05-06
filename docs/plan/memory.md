# Memory System v0

状态：设计草稿
范围：全局文件型 memory store、同步检索工具、闲置后后台总结与维护边界

## 定位

memory 系统用于帮助 agent 迅速定位历史决策、执行结果和可复用结论，减少重复探索和沟通成本。

它记录的是跨会话可复用的工程经验，不是原始 transcript、不是 `task brief`，也不是默认每轮注入的大上下文。

## 存储形态

记忆文件落地到全局目录：

```text
~/.agents/memories/
  2026-05-06-memory-runtime-design.md
  2026-05-06-memory-runtime-design-a1b2.md
```

文件名使用 `YYYY-MM-DD-<task-slug>.md`。同日同名重复时追加短 id。

每个记忆文件包含 metadata 和正文两部分。metadata 用于检索和 stale 判断，正文用于人和 agent 需要证据时继续展开。

最小 metadata 字段：

- `name`
- `description`
- `cwd`
- `keywords`
- `created_at`
- `updated_at`
- `last_verified_at`
- `confidence`
- `touched_paths`
- `evidence_refs`
- `source_session_id`

正文建议包含：

- 背景
- 可复用结论
- 关键证据
- 执行步骤或排查路径
- 过时标注

当发现旧结论与当前代码或事实不匹配时，不硬删原文，只追加标注，例如：

```text
[outdated | refer to: 2026-05-06-new-runtime-contract] [no-matches-fact]
```

## 检索链路

当前任务需要记忆时，主 agent 通过同步 `memory_search` 工具检索。

`memory_search` 直接扫描 `~/.agents/memories/*.md` 的 metadata，按以下信号召回和排序：

- 当前任务描述与 `name` / `description` 的模糊匹配
- `cwd` 与当前工作目录的匹配度
- `keywords` 与用户消息、错误文本、命令、模块名的匹配度
- `touched_paths` 与当前路径或模块的重合度
- `last_verified_at` 与 `confidence`

默认只返回少量命中的 metadata、可复用结论和证据引用。只有当主 agent 需要核查证据时，才继续读取对应记忆正文。

不要默认按 task group 或日期整组加载记忆，避免上下文污染。

## 深度核查

如果命中结果可能影响当前实现判断，但需要更多证据，可以由主 agent 显式开启 memory 子任务做深度核查。

深度核查不作为默认检索路径。它可以读取命中的记忆正文、当前仓库文件和 trace 证据，但对仓库保持只读；只能修改 memory 文件。

这类子任务可以使用现有 background task / subagent 基座，但不应把 `blocking subagent` 当成同步检索工具的替代品。当前任务立即需要的轻量记忆，应由 `memory_search` 同轮返回。

## 后台总结

当一个会话闲置超过 10 分钟后，可以触发 memory 总结候选。

触发边界：

- settings 中显式开启 `memory_enabled = true`
- 由 worker 周期扫描 session 活跃状态，或由 API 在 session 进入可总结状态时 enqueue
- session 必须不在执行中
- session 不能处于等待用户权限、等待冲突确认或等待用户澄清状态
- 同一 session 同一阶段只能有一个未完成的 memory 总结任务

v0 优先复用现有 background task / worker 基座和单任务锁，不单独新增一套 task queue。只有当 memory 任务量明显影响现有 worker 或出现跨会话并发竞争时，再引入独立 memory worker 或派生队列。

后台总结不继承完整 prompt envelope。它只基于下列材料抽取可复用结论：

- session messages
- final answer
- 文件变更摘要
- 关键 tool result 摘要
- trace / run / request id 等证据引用
- 用户明确要求记录的内容

不要把 system prompt、工具定义、完整 runtime context、完整 tool result 或完整 prompt envelope 原样写入 memory。

## 新增与维护

新增记忆的必要性判断：

1. 该任务产生了可复用结论，可以提高同类任务执行效率、成功率，或减少探索成本
2. 用户明确要求记录

新增时只创建新的记忆文件并写入 metadata，不需要选择 task group，也不需要维护额外索引。

维护时可以：

- 补充 `last_verified_at`
- 调整 `confidence`
- 追加新的 `evidence_refs`
- 追加过时标注
- 在新文件中引用被替代的旧结论

## 规模边界

v0 不维护额外索引，直接扫描 metadata。

直接扫描适用于记忆文件数量较小的阶段。可以先设置软上限，例如 1000 到 2000 个文件；超过上限后，再考虑生成派生索引或引入更强检索结构。

派生索引只能作为 cache，不作为唯一事实源。事实源仍然是单个 memory markdown 文件。

## 执行规格

本节描述 v0 目标规格，不表示当前代码已经落地。

### 运行入口

- `memory_search` 是同步工具，用于当前 run 内快速返回少量相关记忆。
- 闲置总结走 background task / worker 基座，不阻塞主 session 的正常回复。
- 深度核查由主 agent 在命中结果需要证据确认时显式触发，不作为默认检索路径。

### `memory_search` 输入输出

最小输入：

- `query`：当前任务描述或用户问题。
- `cwd`：当前工作目录，用于同仓库或同工作区加权。
- `keywords`：错误文本、命令、模块名、功能名等检索信号。
- `paths`：当前任务相关文件或目录。
- `limit`：返回条数上限，默认返回少量候选。

最小输出：

- 命中的记忆文件路径和 metadata。
- 每条命中的可复用结论。
- `evidence_refs`，用于后续核查。
- `needs_detail`，标记是否建议展开正文继续验证。

### 记忆文件写入

- 写入只发生在后台总结任务，或用户明确要求记录时。
- 新文件按 `YYYY-MM-DD-<task-slug>.md` 命名；同名冲突时追加短 id。
- metadata 必须满足“存储形态”中的最小字段。
- 正文按“背景 / 可复用结论 / 关键证据 / 执行步骤或排查路径 / 过时标注”组织。
- 写入内容只保存可复用结论和证据引用，不保存完整 prompt envelope 或完整原始 transcript。

### 闲置总结任务

- API 可以在 session 进入可总结状态时 enqueue；worker 也可以周期扫描满足条件的 idle session。
- enqueue 前必须读取当前工作目录的 effective settings；只有 `memory_enabled = true` 时才允许投递 memory 总结任务。
- enqueue 前必须确认 session 不在执行中，且不处于等待权限、等待冲突确认或等待用户澄清状态。
- 同一 session 同一阶段必须有去重锁，避免重复总结。
- memory agent 对仓库保持只读；唯一允许写入的位置是 `~/.agents/memories`。
- 总结材料只来自 session messages、final answer、文件变更摘要、关键 tool result 摘要、trace / run / request id 引用，以及用户明确要求记录的内容。

### 并发与失败处理

- 同一 session 同一阶段只允许一个未完成的 memory 总结任务。
- 多个任务写入同名记忆文件时，后写入者必须追加短 id，不能覆盖已有文件。
- stale 标注以追加方式写入，不硬删旧结论。
- memory 任务失败只记录诊断和失败原因，不改变主 session 状态，也不阻塞后续用户请求。
- 失败后是否重试由 background task 的通用重试策略控制，memory 层不单独引入重试队列。

### 验收口径

- `memory_search` 能在当前 run 内返回少量相关候选，而不是启动 blocking subagent 作为主检索路径。
- 默认检索结果只包含 metadata、可复用结论和证据引用，不整组加载历史记忆。
- idle 总结不会继承或写入完整 prompt envelope。
- 新增记忆文件包含最小 metadata，并能通过 `cwd`、`keywords`、`touched_paths` 和 `evidence_refs` 支撑后续检索。
- 后台总结失败不会影响主会话回复、权限状态或后续请求。
