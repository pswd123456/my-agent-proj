# Session State Unification Audit

更新时间：2026-04-24
范围：`apps/web/app/_components/session-workbench.tsx` 及关联 workbench 组件

## 背景

最近修复了 workbench 中一组明显的状态不同步问题：

- 权限审批点击同意后，header 没有立即进入“执行中”
- 权限卡片未按预期延时消失
- 侧边栏与 header 展示的会话状态不一致

当前已经落地了一版 `session-state-manager`，把 `currentSession / submitting / interruptingSessionId` 的运行态收口为统一入口，并让 header 与侧边栏都能吃到同一份当前会话实时状态。

但从整个 workbench 看，仍然存在多组“相关状态分散维护”的区域，后续继续加功能时，仍然有较高概率再出现“一个区域更新了，另一个区域没更新”的问题。

这份文档用于记录当前状态审计结果，并给出下一阶段的收口顺序。

## 已经统一的部分

### 1. 当前会话运行态

当前已由 `session-state-manager` 统一管理：

- `currentSession`
- `submitting`
- `interruptingSessionId`
- 流式事件到达时对当前 session 的推进

当前文件：

- `apps/web/app/_components/session-state-manager.ts`

已覆盖的关键事件：

- `turn_start`
- `tool_call`
- `tool_result`
- `permission_request`
- `permission_approved`
- `permission_rejected`
- `permission_blocked`
- `interrupt_requested`
- `interrupted`
- `turn_end`
- `run_complete`
- `run_error`

### 2. 侧边栏当前会话状态显示

当前会通过 `renderedSessions = mergeSessionSummary(sessions, currentSession, toSessionSummary)` 用实时 `currentSession` 覆盖掉 `sessions` 列表里的陈旧 summary，避免 header 与 sidebar 显示不同步。

当前实现位置：

- `apps/web/app/_components/session-workbench.tsx`

## 仍然散落的状态组

## A. Session Registry（高优先级）

当前相关状态：

- `sessions`
- `selectedSessionId`
- URL 中的 `sessionId`
- `currentSession`（已部分收口）
- `selectedSessionIdRef`

当前问题：

- `sessions` 仍然是独立状态源，`currentSession` 只是“覆盖层”
- `selectedSessionId`、URL query、ref 三套值并行存在
- 新建、删除、切换、hydrate、stream finish 后都要分别同步多处状态

典型风险：

- 切换 session 后，一个区域用的是新 session，另一区域仍然是旧 session
- sidebar summary、header session、URL session 三者短时不同步
- 流式回调依赖 `selectedSessionIdRef` 做 active session 判断，容易继续变成隐式约束

建议目标：

抽成一个统一的 `session-registry-manager`，最少覆盖：

- `sessions`
- `selectedSessionId`
- `currentSession`
- `renderedSessions`
- 与路由 query 的同步入口

建议职责：

- `bootstrapSessions(snapshots, requestedSessionId)`
- `selectSession(sessionId)`
- `hydrateSelectedSession(session)`
- `upsertSession(session)`
- `deleteSession(sessionId)`
- `deriveRenderedSessions()`

非目标：

- 不在这个 manager 里直接处理 `streamEvents`
- 不在这个 manager 里直接处理 settings form

## B. Run View State（高优先级）

当前相关状态：

- `streamEvents`
- `recentAssistantEventKeys`
- `pendingUserMessage`
- `message`
- 与一次 submit 生命周期相关的局部清理逻辑

当前问题：

- 这些状态都属于“一次运行中的前端展示态”，但现在散在 `submitSessionMessage()`、`handleAssistantAnimationComplete()`、timeline 派生逻辑里
- `streamEvents` 与 `recentAssistantEventKeys` 紧密耦合，却不是同一入口维护
- `pendingUserMessage` 与 `submitting` 有强关系，但由另一套逻辑维护

典型风险：

- 一次 run 结束后，某些 streaming UI 遗留未清空
- assistant typewriter 和真实 stream completion 不一致
- pending user message 消失时机与 run lifecycle 偏离

建议目标：

抽成 `run-view-state-manager`，统一管理一次运行期的前端可视态。

建议职责：

- `beginRun(message)`
- `appendStreamEvent(event)`
- `markAssistantAnimationComplete(key)`
- `finishRun()`
- `resetRunView()`

至少纳入：

- `streamEvents`
- `recentAssistantEventKeys`
- `pendingUserMessage`

可选纳入：

- `message`

说明：

- `message` 是输入框状态，也可以继续留在 workbench 顶层；不必为了“纯粹统一”强拉进去

## C. Settings Resource + Draft State（中优先级）

当前相关状态：

- `userSettings`
- `settingsForm`
- `loadingSettings`
- `savingSettings`
- `pendingPermissionToolName`

当前问题：

- 这是典型的“远端资源快照 + 本地 draft + 保存过程”三层状态
- 现在设置项切换、自动保存、session 同步设置混在一起
- `pendingPermissionToolName` 只是 settings 保存过程中的局部 loading，但不在统一保存状态模型里

典型风险：

- 表单看起来更新了，但实际远端 session settings 还没同步
- 某个 toggle 的 loading 标识与整体 autosaving 状态脱钩
- 设置错误和运行错误共用 `errorText` 时容易互相覆盖

建议目标：

抽成 `settings-state-manager`，统一处理：

- 远端 settings snapshot
- 当前 form draft
- autosave lifecycle
- 单项 permission toggle pending 状态

建议职责：

- `hydrateSettings(settings)`
- `patchDraft(patch)`
- `beginSave(meta)`
- `commitSaved(settings)`
- `failSave(error)`

## D. Async Action Flags（中优先级）

当前相关状态：

- `loading`
- `loadingSession`
- `creatingSession`
- `deletingSessionId`
- `resettingRoutines`

当前问题：

- 它们都是动作中的 busy flag，但分散在各 handler 里零散维护
- 删除 session 与创建 session 的恢复逻辑也分散在不同分支

建议判断：

- 当前规模下，不一定要先抽 manager
- 但可以至少整理出统一命名和统一 reset 规范

建议方向：

如果后续再增加 session duplication、archive、retry、bulk reset 等动作，再抽 `action-state-manager`

## E. Pure UI View State（低优先级）

当前相关状态：

- `activeSidebarPanel`
- `activeTab`
- `isSessionRailCollapsed`

判断：

- 这组状态是纯 UI 视图控制，不直接承载业务语义
- 当前没有看到明显的同步 bug 模式
- 现阶段不值得为了“统一而统一”引入额外抽象

建议：

- 保持在 component 顶层即可
- 除非后续出现 URL deep-link、跨组件联动、持久化恢复等需求

## 当前最值得继续做的两步

### Step 1. 落 `session-registry-manager`

目标：

把下列会话相关状态先彻底收成一条主线：

- `sessions`
- `selectedSessionId`
- `currentSession`
- `renderedSessions`

完成后应满足：

- session 选择、hydrate、更新、删除都走同一入口
- sidebar / header / drawer 均通过同一 registry 取当前 session 与 summary
- URL query 只作为 registry 的输入/输出边界，不再和内部状态双向散落耦合

### Step 2. 落 `run-view-state-manager`

目标：

把一次运行期展示态单独收口：

- `streamEvents`
- `recentAssistantEventKeys`
- `pendingUserMessage`

完成后应满足：

- submit 开始、事件流推进、assistant typewriter 收尾、run 完成清空都能从单一入口推理
- 不再依赖多个 `setState` 分布在 `submitSessionMessage()` 内部手写拼装

## 暂不建议优先做的事

- 不要现在把所有 `useState` 都强行 reducer 化
- 不要把纯 UI view state 和 session/runtime state 混进同一个 manager
- 不要为了“统一”把 settings、session、streaming 三类状态塞进一个超大 manager

## 推荐分层边界

建议后续保持三个 manager 分层，而不是一个万能 workbench store：

- `session-state-manager`
  - 负责当前 session 的运行态推进
- `session-registry-manager`
  - 负责 session 集合、当前选中 session、summary 同步
- `run-view-state-manager`
  - 负责一次运行期的前端临时展示态

后续如 settings 继续复杂化，再新增：

- `settings-state-manager`

## 验收标准

后续继续做状态收口时，至少应满足以下验收标准：

- header、sidebar、drawer 使用的当前 session 来源一致
- session summary 不再需要临时 patch 才能反映当前运行态
- 一次 run 的开始、进行中、结束后的 stream UI 清理路径可单点追踪
- 新增一个运行态事件时，只需改 manager，不需要在 3~4 个 handler 里同时补状态同步
- 新增一个 settings toggle/loading 行为时，不需要再额外加局部 pending flag 打补丁

## 备注

本审计文档的目标不是要求立刻重写 workbench，而是把“真正值得统一的状态边界”先定清楚，避免未来继续在 `session-workbench.tsx` 内部堆叠横向同步逻辑。
