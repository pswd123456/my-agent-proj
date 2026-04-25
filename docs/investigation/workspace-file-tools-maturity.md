# Workspace 文件工具成熟度评估

日期：2026-04-25

## 背景

本次评估对象是 `my-agent-proj` 当前 `workspace` capability pack 下的 file system 相关工具，并以本机参考项目作为对照：

- `my-agent-proj`: `packages/agent/src/tools/`
- OpenHarness: `/Users/boneda/gitrepo/OpenHarness`
- Hermes Agent: `/Users/boneda/gitrepo/hermes-agent`

评估重点不是“是否有工具”，而是工具是否被稳定的契约、权限、安全边界、错误处理、测试和可观测性包住。

## 结论

当前工具成熟度约为 **6/10**。

它已经是可用于 MVP 的 workspace 工具包：工具面完整，统一 registry 已落地，权限等待流也进入 runtime 主链路。但它还没有达到 OpenHarness / Hermes 那种长期产品化成熟度，主要短板在 sandbox 语义、symlink/realpath 防护、写入可靠性、抗循环能力、敏感内容保护和高风险回归测试。

## 当前实现现状

### 工具面

当前 `createWorkspaceToolRegistry()` 注册了以下工具：

- `read_file`
- `list_directory`
- `search_text`
- `write_file`
- `edit_file`
- `create_directory`
- `delete_path`
- `move_path`
- `copy_path`
- `run_shell_command`
- `make_http_request`

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

- `read_file` 支持 1-based inclusive `startLine` / `endLine`，默认可全文读取。
- `edit_file` 支持行范围替换，并返回 line diff。
- `search_text` 支持 literal / regex 两种模式，优先 `rg`，超时后 fallback 到 Node。
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

结果：`13 pass / 0 fail`。

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

当前 `sandboxProfile` 和 `getSandboxTargets()` 已经出现在工具契约中，但真正路径检查仍主要依赖每个工具内部调用 `normalizeWorkspacePath()`。

另外，当前 execution context 对 `workspace-rooted` 工具默认设置 `allowWorkspaceEscape`，使“workspace-rooted”更像可越界执行的标签，而不是硬边界。这和早期 Stage 4 文档中“越出 workingDirectory 直接阻断”的语义已经不同。

风险：

- 容易出现工具实现漏调路径归一化。
- 不同工具对越界、审批和执行的理解可能漂移。
- 后续新增文件工具时，registry 元数据不等于真实 sandbox enforcement。

### 2. 缺少 realpath / symlink 防护

当前 `normalizeWorkspacePath()` 基于 `path.resolve()` 和 `path.relative()`。这可以拦住普通 `..`，但不能保证 symlink 指向 workspace 外部时仍被拦住。

风险：

- workspace 内部 symlink 指向外部敏感目录时，读写工具可能绕出逻辑工作区。
- `copy_path`、`move_path`、`delete_path` 的目标路径尤其需要 realpath 策略。

### 3. 写入不是原子写

`write_file` 和 `edit_file` 当前直接 `fs.writeFile()`。

风险：

- 进程中断或磁盘异常时可能留下半写文件。
- 并发写或外部编辑时没有明确 warning / precondition。
- edit 成功后虽然返回 diff，但没有自动验证目标文件是否仍是模型以为的版本。

### 4. 没有 read/search loop guard

当前工具不会识别模型反复读同一个文件范围或反复跑同一个搜索。

风险：

- 模型在路径猜测、上下文丢失、工具结果没理解时可能进入重复调用。
- tool result 会继续膨胀 session history，增加 compact 压力。

### 5. 读工具缺少大文件、二进制、设备路径和敏感内容保护

`read_file` 默认全文读取，这符合“不要无上限截断”的近期需求，但还缺少配套安全阀。

风险：

- 大文件可以一次性进入上下文。
- 二进制文件会以 utf8 读取，结果不可控。
- device path 或特殊路径没有专门保护。
- secret-like 内容没有输出层 redaction。

### 6. 搜索能力还偏 v1

`search_text` 已有 `rg` 和 fallback，但相对 Hermes/OpenHarness 还缺：

- `file_glob`
- case sensitivity 控制
- offset / pagination
- context lines
- files-only / count 模式
- 更明确的 invalid regex 反馈

这不是 MVP 阻塞点，但会影响真实代码库探索效率。

## 建议改进顺序

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

- 为 `write_file` / `edit_file` 引入 atomic write helper。
- 写入前可选检查旧内容或 mtime，至少在 stale 场景返回 warning。
- 为 `move_path` / `copy_path` / `delete_path` 补 symlink、overwrite、missing parent 等高风险回归测试。

落点：

- `packages/agent/src/tools/workspace.ts`
- `packages/agent/src/tools/write-file.ts`
- `packages/agent/src/tools/edit-file.ts`
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
