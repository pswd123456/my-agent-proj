# Plan Mode

## 定位

`plan mode` 是当前 session runtime 上的一层执行模式，不是独立 runtime，也不是新的 user default settings。

它解决的是一个很窄的问题：

- 让 agent 在“先规划、暂不改代码”的阶段有显式运行边界
- 让这份规划有一个用户可直接编辑的 artifact
- 让 prompt、权限层和工具面围绕这个边界表现一致

第一版只覆盖工作区普通文件写操作，不扩大到 shell、network、schedule。

## 当前行为

当 `session.context.planModeEnabled = true` 时：

- runtime 会把当前 session 视为 planning 态
- prompt 会在 `runtimeContextMessages` 中明确注入一条专用的 `plan mode prompt`，以及一条控制态 context：
  - `plan mode prompt` 会强调：
    - `todo` 工具在 plan mode 下不可用
    - 通过 `search_task_brief / read_task_brief / edit_task_brief / replace_task_brief` 维护 brief
    - 普通 workspace 文件写工具不可用
    - 需要澄清时优先用 `ask_user_question`
  - 控制态 context 会继续注入：
    - `Plan mode: enabled|disabled`
    - `Task brief path`
    - `Task brief binding`
    - `Task brief next write`
    - `Pending user question payload`
- prompt 暴露给模型的工具列表会隐藏普通 `workspace-file` 写工具
- prompt 暴露给模型的工具列表也会隐藏 `get_todo_list / replace_todo_list / update_todo_items`
- 普通 `workspace-file` 写工具会在权限检查前被直接 block
- `todo` 工具在执行层也会被直接 block
- `task brief` 不能用 shell 重定向或普通 workspace file 工具绕过
- `task brief` 当前推荐通过下列工具消费：
  - `search_task_brief`：先定位 section / line
  - `read_task_brief`：按 1-based 行窗口读取
  - `edit_task_brief`：按 1-based 行范围改写已有 brief
  - `replace_task_brief`：创建第一版 brief，或在整篇重写更便宜时使用

当 `planModeEnabled = false` 时：

- 普通文件写工具恢复原有权限逻辑
- session 仍会保留既有 `taskBriefPath`
- runtime 不会自动删除或重置 brief 文件

## Session 状态

当前 session context 新增两个字段：

- `planModeEnabled: boolean`
- `taskBriefPath: string | null`
- `pendingUserQuestionPayload: PendingUserQuestionPayload | null`

它们属于 session 事实，不属于 user settings。

这意味着：

- `POST /sessions` 可以显式开启 plan mode
- `PATCH /sessions/:sessionId/settings` 可以切换 plan mode
- `GET/PATCH /users/:userId/settings` 不持久化 plan mode 默认值

当前事实源：

- `packages/domain/src/session-context.ts`
- `packages/agent/src/session/shared.ts`
- `packages/db/src/schema.ts`

## Task Brief Artifact

第一版的 task brief 主事实源不是结构化 session state，而是工作区里的 markdown 文件：

```text
<session.workingDirectory>/
  .agent/
    plans/
      <sessionId>/
        <planName>.md
```

固定模板是：

- `# Task Brief`
- `## Goal`
- `## Acceptance Criteria`
- `## Constraints`
- `## Verified Facts`
- `## Decisions`
- `## Next Checkpoint`

设计取向：

- 让用户能直接打开和编辑
- 让 runtime 通过 planning tool surface 读取和维护最新版本
- 不在 v1 做 session.context 与文件内容的双写同步

当前实现里，开启 plan mode 后不会自动为 session 绑定这条路径；第一次写 `task brief` 时，需要通过 `replace_task_brief` 显式提供 `plan_name`，不会在切换瞬间自动写文件。

对于旧 session 可能遗留的 flat legacy 绑定：

- 运行时会继续识别 `.agent/plans/<sessionId>.md`
- 如果 legacy 文件已经存在，不带 `plan_name` 仍可继续覆盖原文件
- 如果 legacy 文件还不存在，下一次 `replace_task_brief` 必须提供 `plan_name`，runtime 会把绑定升级到 `.agent/plans/<sessionId>/<planName>.md`

## 工具面

当前 planning tool surface 里，与 `plan mode` 最直接相关的是下面几类：

- `ask_user_question`
  - 普通 planning 工具，非 `plan mode` 也会暴露给模型
  - 用于结构化澄清需求或不确定点
  - 支持一次只问一个问题，也支持通过 `questions` 一次询问最多 4 个问题
  - 每个问题可附带最多 5 个快捷回复选项，并可显式标记 1 个推荐选项
  - 每个问题默认提供一个“取消”快捷回复；如确实不需要，可通过该问题的 `allow_cancel = false` 关闭
  - 每个问题的 `context_note` 会作为该问题 tab 内的一个“补充说明”选项展示，用户点击后会把说明文本直接返回给模型
  - 调用后会把 session 置为 `waiting_for_user_question`
- `search_task_brief`
  - 只读
  - 在当前 brief 中搜索匹配行
  - 返回 line number 与 snippet
- `read_task_brief`
  - 只读
  - 支持 `startLine/endLine` 或 `offset/limit`
  - 返回 `path / exists / content / startLine / endLine / totalLines / truncated`
- `edit_task_brief`
  - 用于按 inclusive 1-based line range 改写已有 brief
  - 只适合局部编辑
- `get_task_brief`
  - 兼容保留的整篇读取工具
- `replace_task_brief`
  - 创建第一版 brief 或整篇重写时使用
  - 首次写入时必须显式提供 `plan_name`
  - 只允许写当前 session 绑定的 brief 路径
  - 必要时自动创建 `.agent/plans/<sessionId>/`

`ask_user_question` 的当前恢复语义是：

- 当前 run 结束在 `waiting for input`
- workbench 展示结构化 question card；多问题时在同一张卡片内用 tab / 左右导航切换
- 用户在卡片内逐题选择选项或输入回答后发送，也可以在主输入区直接回复
- 用户下一条非空消息直接视为对当前澄清 payload 的回答
- runtime 会先清空 `pendingUserQuestionPayload`，再把这条输入当普通 user message 继续执行

普通文件工具即使目标正好是 `.agent/plans/<sessionId>/<planName>.md`，在 plan mode 下也仍然会被 block。

这条约束的目的，是让“写规划 artifact”和“改工作区普通文件”在 runtime 层明确分离。

## 权限与拦截边界

当前 plan mode 会拦两类工具：

1. 普通 `workspace-file` 写工具
2. `todo` 工具（`get_todo_list / replace_todo_list / update_todo_items`）

当前被 block 的范围：

- `create_directory`
- `write_file`
- `copy_path`
- `move_path`
- `delete_path`
- `apply_patch`
- `get_todo_list`
- `replace_todo_list`
- `update_todo_items`

当前 prompt 不会向模型暴露以上这些普通文件写工具；权限层继续保留 block，作为兜底约束，避免旧消息回放或异常 tool call 绕过 plan mode。`ask_user_question` 不属于这类限制，它作为普通工具保持可见。

当前不受 plan mode 影响的范围：

- `read_file`
- `list_directory`
- `find_files`
- `search_text`
- `git_status`
- `git_diff`
- `ask_user_question`
- `search_task_brief`
- `read_task_brief`
- `edit_task_brief`
- `get_task_brief`
- `replace_task_brief`
- `workspace-shell`
- `workspace-network`
- `schedule`

这不是通用“所有 mutating tool 一律禁用”的实现，而是刻意收敛到工作区文件改动。

- task brief 的写入仍必须走 `replace_task_brief`，不能用 shell 重定向代替。

## Prompt 与 Cache

`plan mode` 的提示不进入 stable prefix。

当前策略是：

- 稳定规则继续放 `system`
- 当前 session 是否处在 plan mode，以及 brief 绑定/写入规则这类控制信息，进入 `runtimeContextMessages`
- plan mode 额外有一条 session 级专用 prompt message，也进入 `runtimeContextMessages`
- brief 正文不再重复注入 `runtimeContextMessages`，当前主要依赖 `read_task_brief / search_task_brief / edit_task_brief / replace_task_brief / get_task_brief` 的 tool result 回放；后续若需要更稳的消费链路，再单独设计

因此：

- brief 正文变化不会进入 `cacheKey`
- prompt cache 仍只依赖 `system + prefixMessages + tools`

如果后续扩展 plan mode，不要把易变 brief 正文挪进 `system` 或 `prefixMessages`，也不要和已有 tool result 回放重复注入。

## UI 与 API

当前 workbench 只提供“当前会话级”的 plan mode 开关，不把它放进用户默认设置。

设置面板会展示：

- 当前 session 的 `plan mode` 开关
- 当前绑定的 `task brief path`

当前 workbench 也支持 `/plan` composer command：

- 这是 workbench 侧的会话级快捷入口
- 选中后会直接把当前 session 的 `planModeEnabled` 设为 `true`
- 不会自动发送一条新的 user message

这和 user settings 中的 `workingDirectory / yoloMode / permission rules` 是两层不同的状态。

## 当前不做的事

第一版明确不做：

- 自然语言自动进出 plan mode
- full compaction 集成
- shell / network / schedule 的 plan mode 限制
- 结构化 `task brief` 双写回 session.context
- section 级碎工具，例如 `append_task_brief_fact`

## 相关事实源

- prompt：`packages/agent/src/prompt.ts`
- permission check：`packages/agent/src/runtime/permission-checker.ts`
- planning tools：`packages/agent/src/tools/registry.ts`
- pending question resume：`packages/agent/src/runtime/user-question.ts`
- task brief helper：`packages/agent/src/session/task-brief.ts`
- API：`apps/api/src/app.ts`
- workbench：`apps/web/app/_components/session-workbench-conversation.tsx`
