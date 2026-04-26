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
- prompt 会在 `runtimeContextMessages` 中明确注入：
  - `Plan mode: enabled|disabled`
  - `Task brief path`
  - `Task brief binding`
  - `Task brief next write`
  - `Pending user question payload`
- prompt 暴露给模型的工具列表会隐藏普通 `workspace-file` 写工具
- 普通 `workspace-file` 写工具会在权限检查前被直接 block
- `planning` family 的 todo 工具仍然可用
- `task brief` 只能通过 `replace_task_brief` 维护，不能用 shell 重定向或普通 workspace file 工具绕过

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

当前 planning tool surface 当前包括三类：

- `ask_user_question`
  - 只在 `plan mode` 开启时暴露给模型
  - 用于结构化澄清需求或不确定点
  - 一次只问一个问题，可附带最多 4 个快捷回复选项
  - 调用后会把 session 置为 `waiting_for_user_question`
- `get_task_brief`
  - 只读
  - 返回 `path / exists / content / truncated`
- `replace_task_brief`
  - 唯一允许写 brief 的入口
  - 首次写入时必须显式提供 `plan_name`
  - 只允许写当前 session 绑定的 brief 路径
  - 必要时自动创建 `.agent/plans/<sessionId>/`

`ask_user_question` 的当前恢复语义是：

- 当前 run 结束在 `waiting for input`
- workbench 展示结构化 question card
- 用户下一条非空消息直接视为对该问题的回答
- runtime 会先清空 `pendingUserQuestionPayload`，再把这条输入当普通 user message 继续执行

普通文件工具即使目标正好是 `.agent/plans/<sessionId>/<planName>.md`，在 plan mode 下也仍然会被 block。

这条约束的目的，是让“写规划 artifact”和“改工作区普通文件”在 runtime 层明确分离。

## 权限与拦截边界

第一版 plan mode 只拦普通 `workspace-file` 写工具。

当前被 block 的范围：

- `create_directory`
- `write_file`
- `edit_file`
- `copy_path`
- `move_path`
- `delete_path`
- `apply_patch`

当前 prompt 不会向模型暴露以上这些普通文件写工具；权限层继续保留 block，作为兜底约束，避免旧消息回放或异常 tool call 绕过 plan mode。

当前不受 plan mode 影响的范围：

- `read_file`
- `list_directory`
- `find_files`
- `search_text`
- `git_status`
- `git_diff`
- `planning` family 的 todo 工具
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
- brief 正文不再重复注入 `runtimeContextMessages`，当前主要依赖 `replace_task_brief` / `get_task_brief` 的 tool result 回放；后续若需要更稳的消费链路，再单独设计

因此：

- brief 正文变化不会进入 `cacheKey`
- prompt cache 仍只依赖 `system + prefixMessages + tools`

如果后续扩展 plan mode，不要把易变 brief 正文挪进 `system` 或 `prefixMessages`，也不要和已有 tool result 回放重复注入。

## UI 与 API

当前 workbench 只提供“当前会话级”的 plan mode 开关，不把它放进用户默认设置。

设置面板会展示：

- 当前 session 的 `plan mode` 开关
- 当前绑定的 `task brief path`

这和 user settings 中的 `workingDirectory / yoloMode / permission rules` 是两层不同的状态。

## 当前不做的事

第一版明确不做：

- `/plan` slash command
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
