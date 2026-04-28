# 主线与能力包

## 当前主线

- 仓库主线定义调整为：一个面向个人助手场景的通用 `agent runtime`
- 默认优先支持工作区理解、文件操作、权限控制、可观测执行和可扩展的助手型能力

## 分层定义

### 1. Core runtime

这层是仓库最稳定、最通用的部分：

- 模型调用与 provider 适配
- session 生命周期与持久化
- trace / SSE / 调试可观测性
- tool 调度与执行循环
- prompt 组装与缓存边界

这层的职责是“跑通 agent”，而不是绑定某个具体产品领域。

当前有几个能力属于 core runtime，而不是 capability pack：

- `planning` 工具面，包括 `ask_user_question`、task brief 读写、todo 交互和 `get_current_time`
- `manage_capability_packs`，也就是读取和切换 session capability pack 的 core/planning 工具
- `delegation`，也就是主 agent 发起和回收 delegated subagent
- `MCP`，也就是工作区级按次装配的动态工具挂载

### 2. Capability pack

能力包是挂在 runtime 上的一组领域能力，可以包含：

- 一组 tool schema 与执行实现
- 对应的 prompt 增量约束
- 必要的数据访问依赖
- 专项文档与测试

当前仓库里，真正按 pack 装配的是下面两组：

- `workspace`：`apply_patch`、`read_file`、`list_directory`、`find_files`、`search_text`、`write_file`、`create_directory`、`delete_file`、`delete_path`、`move_path`、`copy_path`、`git_status`、`git_diff`、`git_diff_cached`、`run_shell_command`、`make_http_request`、`search_skill`、`load_skill`
- `schedule`：`create_routine` / `edit_routine` / `delete_routine` / `search_routine_by_oclock` / `list_routine_by_week` / `list_routine_by_date` / `ask_for_confirmation`

其中 `schedule` 会继续使用当前的：

- `RoutineRepository`
- `create_routine` / `edit_routine` / `delete_routine`
- confirmation 相关等待流转

`ask_user_question` 不属于 capability pack；它只在 `plan mode` 开启时作为 planning 工具面的一部分暴露。

`manage_capability_packs` 也不属于 capability pack 本身；它只是让 model 读取和调整 session 级 pack 装配的管理工具。当前实现里，enable / disable 只会写回 session 状态，并从下一次 run 开始影响实际 mounted tools。

## 当前建议阅读顺序

- 想理解仓库整体主线，先看 [项目概览](./overview.md)
- 想看具体日程能力怎么落地，再看 [`docs/plan/product1.md`](/Users/boneda/gitrepo/my-agent-proj/docs/plan/product1.md)
