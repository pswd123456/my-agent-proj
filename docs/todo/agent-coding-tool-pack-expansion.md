# Agent Coding Tool Pack Expansion

更新时间：2026-04-28
状态：已落地
范围：`packages/agent` coding-oriented tool pack / runtime tool registry / regression tests

## 背景

当前仓库已经有一套可用的通用 runtime 工具：

- workspace 文件读写与搜索
- shell / http
- todo 与日程能力

这些工具已经补齐长任务 coding 场景里的几块关键能力：

1. 代码修改不够“补丁化”
2. 代码库状态不够“git 化”
3. 文件发现不够“路径化”

如果只靠 `write_file` 的整文件写入、`run_shell_command` 和 `search_text`，agent 也能干活，但会更容易出现：

- 改动不稳
- 需要手动确认当前工作树状态
- 文件定位和批量读取来回切换，节奏发散

这份文档保留当时的规格与当前落地结果，后续复查应以 `packages/agent/src/tools/registry.ts` 和相关测试为准。

## 当前落地结果

- `edit_file` 已作为唯一局部编辑工具注册到 `workspace` pack，采用 `path` + `oldString` + `newString` + `replaceAll` 契约；内部仍生成统一 diff，用于 review、undo 与 reapply
- `git_status`、`git_diff`、`git_diff_cached` 已作为只读 git 工具注册到 `workspace` pack
- `find_files` 已作为路径发现工具注册到 `workspace` pack，用于先按路径模式找文件，再进入 `read_file` / `search_text`
- `write_file` 当前保留为新建文件与整文件替换入口；局部修改优先走 `edit_file`
- `PERMISSION_TOOL_OPTIONS`、settings permission tool options 与 registry 测试已覆盖这些工具

## 本次决策

### 1. 收敛为字符串替换型编辑工具

当前已改为 `edit_file`，承接局部修改；`write_file` 保留为新建文件与整文件替换入口。模型侧不再直接编写 unified diff，diff 由工具内部统一生成。

建议能力：

- 支持精确字符串或相邻文本块替换
- 支持通过 `replaceAll` 替换单文件内全部匹配
- 修改或删除已有文件前，要求本 session 内先用 `read_file` 读取过目标文件且文件未变化
- 返回结构化的改动摘要和可 undo / reapply 的统一 diff

目标不是让模型手写 patch，而是让 agent 做局部文件编辑时，不必依赖脆弱的行号或整文件重写。

### 2. 补只读 git 工具

已补下面这组只读工具：

- `git_status`
- `git_diff`
- `git_diff_cached`

可选再补：

- `git_show`
- `git_log_paths`

这些工具的职责是让 agent 在 coding 长任务里能直接看到：

- 当前工作树是否干净
- 改了哪些文件
- 暂存区和未暂存区分别是什么
- 最近一次改动的上下文是什么

它们不负责提交、推送或改写历史。

### 3. 补文件发现工具

已新增 `find_files` 作为轻量路径发现工具，优先覆盖：

- 按 glob 找文件
- 按目录 / 后缀 / 文件名模式列出候选文件

建议命名方向：

- `find_files`
- 或 `glob_files`

它的定位是补足 `search_text` 之外的“先找文件，再看内容”的工作流。

## 实现边界

### 建议落点

- `packages/agent/src/tools/`
- `packages/agent/src/tools/registry.ts`
- `packages/agent/tests/`
- 如需共享路径/结果格式，可在 `packages/agent/src/tools/` 下就近抽公共 helper

### 工具契约要求

新工具必须保持和现有 tool contract 一致：

- 明确 `family`
- 明确 `isReadOnly` / `hasExternalSideEffect`
- 明确 `permissionProfile`
- 明确 `sandboxProfile`
- 输入输出使用结构化 schema

### git 工具约束

这些工具只读，不做任何写操作：

- 不允许自动 `commit`
- 不允许自动 `push`
- 不允许自动改 stage

如果后续要做写 git 动作，必须单独写新文档。

### edit_file 工具约束

`edit_file` 只负责“把局部修改表达得更稳”，不负责自动判断业务正确性。

它应该：

- 让模型用 `oldString` / `newString` 表达精确替换
- 减少手工行号编辑的脆弱性
- 保留可审计、可 undo / reapply 的 diff 结果

它不应该：

- 隐式重写大量无关内容
- 变成全自动 refactor 引擎

## 验收标准

完成后应满足：

1. agent 能用 `edit_file` 完成比行号替换更稳的局部文件修改
2. agent 能直接通过 git 只读工具查看当前工作树状态与改动范围
3. agent 能先按文件路径模式找文件，再进入内容搜索
4. 这些工具能被注册进 `ToolRegistry`，并在测试里覆盖基础行为
5. 现有 workspace / permission / trace 机制不被破坏

## 建议的测试最小集

- `edit_file` 的成功修改路径
- `edit_file` 的失败输入路径
- git status / diff 的只读输出
- glob / find 的路径匹配
- registry 注册与 capability pack 可见性

## 暂不做

- 不做自动 commit / push
- 不做写 git 工具
- 不做复杂的 repo 智能索引
- 不把 shell 包成 git 代理
