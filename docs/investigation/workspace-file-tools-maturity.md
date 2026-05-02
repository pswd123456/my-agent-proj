# Workspace 文件工具成熟度评估

日期：2026-04-25

更新：2026-04-28

状态：历史调查已转成 `docs/todo/workspace-file-tools-hardening.md` 并完成多轮落地。本文保留对比分析，但“当前实现现状”已按当前代码事实刷新；后续执行优先看架构文档、todo 落地结果和 `packages/agent/src/tools/registry.ts`。

## 背景

本次评估对象是 `my-agent-proj` 当前 `workspace` capability pack 下的 file system 相关工具，并以本机参考项目作为对照：

- `my-agent-proj`: `packages/agent/src/tools/`
- OpenHarness: `/Users/boneda/gitrepo/OpenHarness`
- Hermes Agent: `/Users/boneda/gitrepo/hermes-agent`

评估重点不是“是否有工具”，而是工具是否被稳定的契约、权限、安全边界、错误处理、测试和可观测性包住。

## 结论

当前工具成熟度约为 **7/10**；原始调查时约为 **6/10**。

它已经是可用于 MVP 的 workspace 工具包：工具面完整，统一 registry、权限等待、workspace sandbox preflight、fresh read/stale check、基础抗循环防护都进入 runtime 主链路。但它还没有达到 OpenHarness / Hermes 那种长期产品化成熟度，主要短板转向敏感内容保护、更强的多目标回归测试和长期代码库探索效率。

## 当前实现现状

### 工具面

当前 `createWorkspaceToolRegistry()` 注册了以下工具：

- `apply_patch`
- `read_file`
- `list_directory`
- `find_files`
- `search_text`
- `write_file`
- `create_directory`
- `delete_file`
- `delete_path`
- `manage_path`
- `git_status`
- `git_diff`
- `git_diff_cached`
- `run_shell_command`
- `make_http_request`
- `search_skill`
- `load_skill`

事实源：

- `packages/agent/src/tools/registry.ts`
- `packages/agent/src/tools/runtime-tool.ts`

这说明 workspace tool pack 已经从早期只读文件工具，进入了完整 workspace ops 的第一版。

### 契约与权限

每个 runtime tool 都需要声明：

- `family`
- `isReadOnly`
- `hasExternalSideEffect`
- `permissionProfile`
- `sandboxProfile`
- `inputSchema`
- `validate()`
- `execute()`

registry 会拒绝缺少关键元数据的工具。`destructive-only` 工具必须实现 `getPermissionRequest()`，`workspace-rooted` 工具必须实现 `getSandboxTargets()`。

权限检查插在：

1. tool lookup
2. input validate
3. permission check
4. execute

对应事实源：

- `packages/agent/src/runtime/tool-execution.ts`
- `packages/agent/src/runtime/permission-checker.ts`
- `packages/domain/src/permission-rules.ts`
- `packages/domain/src/session-settings.ts`

这层设计方向是对的：权限不是散落在 UI，也不是工具执行后回滚，而是在执行前暂停。

### 已具备的能力

- `read_file` 支持 1-based inclusive `startLine` / `endLine` 和 `offset` / `limit`，并带大文件、二进制、设备路径与重复读取防护。
- `apply_patch` 承接行级和多文件修改；已有文件修改或删除前要求本 session 内先通过 `read_file` 读取且文件未变化。
- `write_file` 保留为新建文件与整文件替换入口；已有文件写入前同样要求本 session 内的 fresh `read_file`。
- `delete_file` 承接文件删除并带 fresh read / stale check；`delete_path` 仍负责更通用的路径删除。
- `find_files` 提供路径发现；`git_status` / `git_diff` / `git_diff_cached` 提供只读 git 状态观察。
- `search_text` 支持 literal / regex、`fileGlob`、case sensitivity、offset、context lines 和输出模式控制，优先 `rg`，超时后 fallback 到 Node。
- `run_shell_command` 默认 timeout 为 `120_000ms`，支持 per-call `timeoutMs`。
- 工具结果统一返回结构化 `ToolResult`，并提供 `displayText`。
- 权限请求、批准、拒绝、阻断和工具结果会进入 trace / event 流。

本次复核通过的测试：

```bash
bun test packages/agent/tests/file-tools.test.ts \
  packages/agent/tests/search-text.test.ts \
  packages/agent/tests/run-shell-command.test.ts \
  packages/agent/tests/registry-permissions.test.ts
```

这组测试是历史快照；当前工具面已扩大，复查时应同时跑 `packages/agent/tests/coding-tool-pack.test.ts`、`packages/agent/tests/file-tools.test.ts`、`packages/agent/tests/search-text.test.ts` 和 `packages/agent/tests/registry-permissions.test.ts`。

## 与 OpenHarness 对照

OpenHarness 的 file tools 本身不一定比当前项目更宽，但它的工程边界更成熟：

- `read_file`、`write_file`、`edit_file`、`grep`、`glob` 都有独立工具。
- Query loop 在执行工具前统一解析 `file_path` / `path` / `root`，再交给 `PermissionChecker.evaluate()`。
- `PermissionChecker` 有敏感路径内置 deny list、path rules、read-only 直通、default/plan/full-auto 模式。
- 持久化写入使用 `atomic_write_text()` / `atomic_write_bytes()`，有 temp file + fsync + `os.replace()` 的原子写保护。
- engine 会记录 read file state、active artifacts、recent verified work，帮助后续 compact/carryover。

参考事实源：

- `/Users/boneda/gitrepo/OpenHarness/src/openharness/tools/file_read_tool.py`
- `/Users/boneda/gitrepo/OpenHarness/src/openharness/tools/file_write_tool.py`
- `/Users/boneda/gitrepo/OpenHarness/src/openharness/tools/file_edit_tool.py`
- `/Users/boneda/gitrepo/OpenHarness/src/openharness/tools/grep_tool.py`
- `/Users/boneda/gitrepo/OpenHarness/src/openharness/tools/glob_tool.py`
- `/Users/boneda/gitrepo/OpenHarness/src/openharness/permissions/checker.py`
- `/Users/boneda/gitrepo/OpenHarness/src/openharness/engine/query.py`
- `/Users/boneda/gitrepo/OpenHarness/src/openharness/utils/fs.py`

对当前项目的启发：不要只让每个工具自己做路径处理，应该在 permission/sandbox 层统一理解工具目标路径。

## 与 Hermes Agent 对照

Hermes Agent 的文件工具更像“长期线上跑过”的产品化工具集：

- `read_file_tool` 有 device path block，避免 `/dev/zero`、`/dev/stdin` 这类路径导致阻塞或无限输出。
- 有 binary extension guard 和大文件读取上限，避免把不可读或超大内容塞进上下文。
- read/search 有 dedup、连续重复 warning、连续重复 hard block。
- context compression 后会 reset file dedup，避免模型引用已被压缩掉的旧内容。
- 写入和 patch 前会检查 file staleness，对外部修改给 warning。
- 写路径有 `WRITE_DENIED_PATHS` / `WRITE_DENIED_PREFIXES`，并支持 `HERMES_WRITE_SAFE_ROOT`。
- patch 支持 fuzzy replace、V4A patch、diff、部分 lint 检查。
- 输出层做 secret redaction。
- 安全文档明确说明 approval system、terminal/file operations、container sandbox 的信任边界。

参考事实源：

- `/Users/boneda/gitrepo/hermes-agent/tools/file_tools.py`
- `/Users/boneda/gitrepo/hermes-agent/tools/file_operations.py`
- `/Users/boneda/gitrepo/hermes-agent/tools/path_security.py`
- `/Users/boneda/gitrepo/hermes-agent/tools/approval.py`
- `/Users/boneda/gitrepo/hermes-agent/SECURITY.md`
- `/Users/boneda/gitrepo/hermes-agent/tests/tools/test_file_read_guards.py`
- `/Users/boneda/gitrepo/hermes-agent/tests/tools/test_file_staleness.py`
- `/Users/boneda/gitrepo/hermes-agent/tests/tools/test_write_deny.py`

对当前项目的启发：成熟文件工具不仅要能读写，还要能防止模型在错误路径、重复读取、超大输出、敏感路径和脏写场景里浪费回合或制造风险。

## 当前主要风险

### 1. Sandbox 语义不够硬

当前 `sandboxProfile` 和 `getSandboxTargets()` 已经出现在工具契约中，runtime 会在工具执行前做统一 workspace sandbox preflight。显式 workspace 外路径走 session 级审批；symlink / realpath escape 默认阻断。

风险：

- 后续新增文件工具时仍必须实现准确的 `getSandboxTargets()`，否则统一 preflight 无法覆盖真实目标。
- 显式 workspace 外授权是 session 级放行，需要继续和普通 tool allow/ask/deny 语义分开。

### 2. realpath / symlink 防护已补第一版

当前 workspace sandbox preflight 会检查 realpath / symlink escape，并默认阻断隐藏越界。

风险：

- 这层仍需要靠高风险回归测试守住，尤其是 `manage_path`、`delete_path` 这类多目标工具。

### 3. 写入可靠性已补第一版

`write_file` 已切到 atomic write helper；`apply_patch` 承接行级和多文件修改，并对已有文件做 fresh read / stale check。

风险：

- 仍需继续关注并发写、外部编辑和多目标操作的回归覆盖。

### 4. read/search loop guard 已补第一版

当前 `read_file` / `search_text` 已有重复调用 warning / block 的第一版防护。

风险：

- 防护策略需要继续和 compact、tool result 展示、用户可理解的错误文案一起演进。

### 5. 读工具已补基础安全阀，敏感内容保护仍待设计

`read_file` 已补 binary / device / safe output guard、行分页和大文件输出限制。

风险：

- secret-like 内容 redaction 仍未成为稳定契约；如果要做，应单独写输出安全策略。

### 6. 搜索能力已扩展，仍需提升探索效率

`search_text` 已从 v1 扩展出更多代码库探索参数，包括：

- `fileGlob`
- case sensitivity 控制
- offset / pagination
- context lines
- files-only / count 模式
- 更明确的 invalid regex 反馈

后续重点不再是补基础参数，而是继续提升真实代码库探索效率和抗循环能力。

## 已采用的改进顺序

以下顺序已转入 `docs/todo/workspace-file-tools-hardening.md` 并完成主要落地，保留在这里用于追溯当时为什么这样拆阶段。

### P0：统一 sandbox enforcement

目标：

- 在 permission/sandbox 层统一读取 `getSandboxTargets()`。
- 对所有 `workspace-rooted` 工具执行前做 realpath 校验。
- 明确区分：
  - workspace 内：正常按工具权限执行
  - workspace 外：进入显式审批或硬阻断
  - symlink escape：默认阻断，除非有明确设计选择

落点：

- `packages/agent/src/runtime/tool-execution.ts`
- `packages/agent/src/runtime/permission-checker.ts`
- `packages/agent/src/tools/workspace.ts`
- `packages/agent/tests/permission-flow.test.ts`
- `packages/agent/tests/file-tools.test.ts`

//加入workspace路径审批类似工具审批，默认超出workspace的操作进行审批，但是每个session只审批一次，就是只审批是否允许超出当前workspace的操作

### P1：写入可靠性

目标：

- 为 `write_file` / `apply_patch` 引入 atomic write / fresh read / stale check。
- 写入前可选检查旧内容或 mtime，至少在 stale 场景返回 warning。
- 为 `manage_path` / `delete_path` 补 symlink、overwrite、missing parent 等高风险回归测试。

落点：

- `packages/agent/src/tools/workspace.ts`
- `packages/agent/src/tools/write-file.ts`
- `packages/agent/src/tools/apply-patch.ts`
- `packages/agent/src/tools/move-path.ts`
- `packages/agent/src/tools/copy-path.ts`
- `packages/agent/src/tools/delete-path.ts`

### P2：读与搜索防护

目标：

- `read_file` 增加 binary / device / max output guard。
- 对 secret-like 输出做 display-level redaction，或至少先在 docs 中明确当前不做。
- 记录 per-session read/search tracker，用于重复读取 warning 和 hard block。
- context compression 后能清理或刷新相关 tracker。

落点：

- `packages/agent/src/tools/read-file.ts`
- `packages/agent/src/tools/search-text.ts`
- `packages/agent/src/runtime/`
- `packages/agent/tests/file-tools.test.ts`
- `packages/agent/tests/search-text.test.ts`

### P3：搜索体验增强

目标：

- 支持 `fileGlob`
- 支持 `caseSensitive`
- 支持 `offset`
- 支持 `contextLines`
- 支持 `outputMode: content | files_only | count`

这部分可以等 P0/P1 稳定后再做，不要先把工具 schema 做复杂。

//可以做

## 成熟度判断表

| 维度                   | 当前项目            | OpenHarness       | Hermes Agent                  |
| ---------------------- | ------------------- | ----------------- | ----------------------------- |
| 工具覆盖面             | 较全                | 中等              | 很全                          |
| 统一 registry          | 已有                | 已有              | 已有 toolset/registry         |
| 权限前置检查           | 已有                | 更成熟            | 更成熟                        |
| path rules             | 基础                | 成熟              | 成熟                          |
| symlink/realpath 防护  | 不足                | 较好              | 较好                          |
| 原子写                 | 无                  | 有                | 部分通过 backend/操作策略覆盖 |
| stale write warning    | 无                  | 有相关状态沉淀    | 有                            |
| read/search loop guard | 无                  | 有 carryover 状态 | 有 dedup/warning/block        |
| 大文件/二进制保护      | 不足                | 有基础处理        | 成熟                          |
| secret redaction       | 不足                | 有敏感路径保护    | 有输出 redaction              |
| 回归测试               | 覆盖核心 happy path | 更宽              | 很宽                          |

## 最小可执行后续

如果下一步要落代码，建议先做一个窄任务：

> 统一 `workspace-rooted` 工具的 sandbox target 校验，并补 symlink escape 回归测试。

这个任务收益最大，因为它能把当前工具契约从“声明存在”推进到“runtime 真实执行”，也能减少后续新增工具时的重复风险。
