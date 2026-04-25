# Workspace File Tools Hardening

更新时间：2026-04-26
状态：P0 已落地，P1 / P2 / P3 待继续
范围：`packages/agent` workspace file tools / permission flow / session persistence / workbench permission UI / regression tests

## 背景

`docs/investigation/workspace-file-tools-maturity.md` 已经完成现状调研，结论是当前 workspace 文件工具可用于 MVP，但还没有把 sandbox、越界审批、写入可靠性和读搜索防护做成稳定契约。

这份 todo 文档把调研结论收敛为可执行规格，并吸收两条补充决策：

1. workspace 外路径不再一律硬阻断；默认进入审批
2. 这类审批不是按单个工具重复确认，而是“本 session 是否允许 workspace 外文件操作”只确认一次

说明：

- 这会替代 `docs/plan/stage4.md` 里“文件越界访问仍然一律阻断”的旧表述
- 替代范围仅限 `workspace-file` family；不扩展到 shell / network / mcp
- 本文先把 P0 写成可直接实现的规格，再把 P1/P2/P3 保留为顺序明确的后续阶段

## 本次落地结果

已完成：

- P0：session 级 workspace 越界授权
- P0：runtime 统一 workspace sandbox preflight
- P0：workspaceEscapeAllowed 持久化 / 恢复
- P0：workbench 快捷回复文案切换为 `本会话允许 workspace 外文件操作`
- P0：permission flow / file tools / postgres session manager / workbench conversation 回归测试

待继续：

- P1：写入可靠性
- P2：读与搜索防护
- P3：搜索体验增强

## 本次决策

### 1. 引入 session 级 workspace 越界授权

新增 session context 字段：

```ts
workspaceEscapeAllowed: boolean;
```

语义：

- 默认 `false`
- 只表示“当前 session 是否允许 `workspace-file` 工具访问 workspace 外路径”
- 一旦用户批准，本 session 后续所有 `workspace-file` 工具都不再为越界路径重复弹权限卡
- 该授权只作用于当前 session，不写入全局 settings

落点：

- `packages/domain/src/session-context.ts`
- `packages/db/src/schema.ts`
- `packages/agent/src/session/shared.ts`
- `packages/agent/src/session/postgres-session-manager.ts`

### 2. 继续复用现有 permission request，但把 workspace 越界作为独立语义

当前已有：

```ts
PendingPermissionRequest.allowWorkspaceEscape?: boolean;
```

本次固定其语义：

- 普通工具审批：`allowWorkspaceEscape` 为空
- workspace 越界审批：`allowWorkspaceEscape: true`

也就是说，这个字段不再只是“恢复执行时顺手带一个 flag”，而是明确表示：

- 当前 pending request 的原因是 workspace 越界
- 用户同意后，需要同时做两件事：
  - 把 `session.context.workspaceEscapeAllowed` 置为 `true`
  - 重新执行当前这次 tool call，并带 `allowWorkspaceEscape: true`

这样可以复用现有 pending-permission 恢复链路，不必再引入第二套审批 payload。

### 3. workspace 越界审批不同于 tool allow list

批准 workspace 越界请求后：

- 不写入 `toolAllowList`
- 不移除 `toolAskList` 中的某个工具名
- 不把它伪装成 `本会话允许 tool:xxx`

因为这次批准的对象不是“某个工具”，而是“当前 session 是否允许 workspace 外文件操作”。

## P0：统一 sandbox enforcement 与 session 级 workspace 越界审批

### 目标

把 `workspace-rooted` 工具的 sandbox 从“工具内部各自判断路径”推进到“runtime 统一识别目标路径并决定 allow / ask / block”。

### 行为规则

#### A. workspace 内路径

- 目标路径位于 `session.workingDirectory` 内
- 按现有工具权限规则继续执行
- 不触发新的 workspace 越界审批

#### B. workspace 外显式路径

例如：

- `../foo.txt`
- `../../other-project`
- `/tmp/demo.txt`

处理方式：

- 如果 `session.context.workspaceEscapeAllowed === false`，进入 `ask_user`
- 如果 `session.context.workspaceEscapeAllowed === true`，允许继续执行

#### C. symlink / realpath escape

例如：

- 路径字面量在 workspace 内
- 但 realpath 指向 workspace 外部

第一版固定为：

- 默认 `block`
- 不走“一次批准后本 session 放行”的路径

原因：

- 这是隐藏越界，不是用户显式指定的目标
- 一次性放开 symlink escape 会把实际边界变得不可解释
- 如果后续需要支持，必须单独写文档说明信任边界

#### D. yolo mode 不绕过 workspace 越界审批

`yoloMode` 第一版不自动放过以下场景：

- workspace 外显式路径审批
- symlink / realpath escape 阻断

也就是说：

- `yolo` 继续只影响原本可跳过的普通 destructive-only 审批
- 不扩大到 workspace sandbox 边界

### 实现方式

#### 1. 统一做 sandbox target preflight

新增统一 helper，负责：

- 读取 `tool.getSandboxTargets()`
- 基于 `session.workingDirectory` 解析目标路径
- 同时检查 lexical path 和 realpath
- 对不存在的目标，至少检查最近存在的父目录 realpath
- 返回每个 target 的分类结果：
  - `inside_workspace`
  - `outside_workspace`
  - `symlink_escape`

建议落点：

- `packages/agent/src/tools/workspace.ts`

建议抽成两个层次：

- 路径解析/分类 helper
- 供 permission checker / tool execution 复用的 preflight helper

#### 2. 在 runtime 里消费 preflight 结果

`tool-execution.ts` / `permission-checker.ts` 需要在 `tool.validate(...)` 之后、`tool.execute(...)` 之前读取 preflight 结果。

决策顺序固定为：

1. 未知工具报错
2. 输入校验失败报错
3. `workspace-rooted` 工具执行 sandbox preflight
4. 根据 preflight 结果决定 `allow / ask_user / block`
5. 只有通过后才进入 `tool.execute(...)`

#### 3. execution context 默认不再为 workspace-rooted 自动开启 escape

当前 `createToolExecutionContext()` 会把：

```ts
allowWorkspaceEscape = input.allowWorkspaceEscape ?? tool.sandboxProfile === "workspace-rooted"
```

这层默认值需要收紧。

改成：

- 默认 `false`
- 只有两种情况才设为 `true`
  - 用户刚批准了 workspace 越界请求，恢复执行当前 tool call
  - 当前 session 已经有 `workspaceEscapeAllowed === true`

#### 4. workspace 越界请求的 permission request 形态

当 preflight 判断为 `outside_workspace` 且当前 session 尚未授权时，构造普通 `PendingPermissionRequest`，但内容要固定：

- `allowWorkspaceEscape: true`
- `summaryText` 明确说明这是“允许 workspace 外文件操作”的 session 级授权
- `contextNote` 可列出本次触发审批的目标路径

推荐 summary 文案方向：

```text
需要你的确认后才能访问 workspace 外路径。本次同意后，当前 session 的后续文件操作将不再重复询问。
```

不要求新增前端组件；现有 permission card 可继续复用。

#### 5. 审批恢复逻辑

`handlePendingPermissionReply(...)` 对 `allowWorkspaceEscape: true` 的请求新增固定行为：

1. 清空 `pendingPermissionRequest`
2. 把 `session.context.workspaceEscapeAllowed` 置为 `true`
3. 不写入 `toolAllowList`
4. 重新执行当前 tool call，并带 `allowWorkspaceEscape: true`

显式文本回复也要支持：

- `"本会话允许 workspace 外文件操作"`

workbench 快捷回复按钮也改成这个文案，不再显示 `本会话允许 tool:${toolName}`。

### 需要改的文件

- `packages/agent/src/runtime/tool-execution.ts`
- `packages/agent/src/runtime/permission-checker.ts`
- `packages/agent/src/runtime/permission.ts`
- `packages/agent/src/tools/workspace.ts`
- `packages/agent/src/tools/runtime-tool.ts`
- `packages/domain/src/session-context.ts`
- `packages/db/src/schema.ts`
- `packages/agent/src/session/shared.ts`
- `packages/agent/src/session/postgres-session-manager.ts`
- `apps/web/app/_components/session-workbench-conversation.tsx`

### 验收标准

完成后必须满足：

1. 第一次对 workspace 外显式路径执行 `workspace-file` 工具时，会进入 permission request
2. 用户批准后，本 session 内再次访问 workspace 外路径，不再重复询问
3. 该批准不会把具体工具写入 `toolAllowList`
4. 新 session 默认仍然需要重新审批
5. symlink / realpath escape 仍然返回 block
6. `yoloMode` 不会跳过 workspace 越界审批
7. prompt / session / API / workbench 中的 pending permission 状态仍然能正确恢复和展示

## P1：写入可靠性

### 目标

- 为 `write_file` / `edit_file` 引入 atomic write helper
- 为写路径相关工具补齐高风险回归测试
- 至少在 stale 写入场景给出 warning

### 范围

- `packages/agent/src/tools/workspace.ts`
- `packages/agent/src/tools/write-file.ts`
- `packages/agent/src/tools/edit-file.ts`
- `packages/agent/src/tools/move-path.ts`
- `packages/agent/src/tools/copy-path.ts`
- `packages/agent/src/tools/delete-path.ts`

### 验收重点

- 写入中断不留下半写文件
- overwrite / missing parent / stale target / symlink path 都有测试
- `edit_file` 返回成功前，至少能发现明显 stale 场景

## P2：读与搜索防护

### 目标

- `read_file` 增加 binary / device / max output guard
- 为 read/search 增加 per-session 重复调用跟踪
- context compression 后清理相关 tracker

### 范围

- `packages/agent/src/tools/read-file.ts`
- `packages/agent/src/tools/search-text.ts`
- `packages/agent/src/runtime/`
- `packages/agent/tests/file-tools.test.ts`
- `packages/agent/tests/search-text.test.ts`

### 第一版约束

- secret redaction 如果这轮不做实现，必须在对应文档里明确写成非目标

## P3：搜索体验增强

这部分可以做，但不应挡住 P0/P1/P2。

### 目标

- 支持 `fileGlob`
- 支持 `caseSensitive`
- 支持 `offset`
- 支持 `contextLines`
- 支持 `outputMode: content | files_only | count`

### 原则

- 先把 schema 扩展控制在 `search_text`
- 不顺手引入新的独立搜索工具
- invalid regex 的报错要变成清晰、结构化、可测试的返回

## 测试清单

至少补这些测试：

- `packages/agent/tests/permission-flow.test.ts`
  - workspace 外首次访问触发审批
  - 同 session 二次访问直接通过
  - 新 session 重新审批
  - workspace 越界批准不污染 `toolAllowList`
  - `yoloMode` 不绕过
- `packages/agent/tests/file-tools.test.ts`
  - `..` / 绝对路径越界
  - symlink escape block
  - missing target 取最近父目录 realpath
- `apps/web/app/_components/session-workbench-conversation.test.ts` 或对应现有测试文件
  - workspace 越界请求显示正确快捷回复
- `packages/agent/tests/postgres-session-manager.test.ts`
  - `workspaceEscapeAllowed` 能持久化与恢复

## 不做

- 不把 workspace 越界授权升级为用户级或全局设置
- 不把这套授权复用到 shell / network / mcp
- 不在本次把 symlink escape 变成可审批项
- 不顺手重做 permission card UI
- 不把搜索体验增强提前到 P0 前面

## 交付顺序

建议按下面顺序落地：

1. P0：先把 session 级 workspace 越界审批和 sandbox preflight 立住
2. P1：再补写入可靠性
3. P2：补读和搜索防护
4. P3：最后做搜索体验增强

只有 P0 落完，当前 `workspace-rooted` 的边界语义才算真正稳定。
