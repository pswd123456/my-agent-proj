# Stage 4: unified tool entry + workspace full ops + permission checker v1

## 文档状态

这份文档记录 Stage 4 的工具面与权限层设计稿，保留的是演进路径，不是所有实现细节的当前唯一事实源。当前运行行为请优先看 `docs/architecture/` 里的工具、权限和 workspace 配置文档。

## 目标

- 把 runtime 的 tool surface 从“当前手工挂载的一小组工具”升级为一个可持续扩展的统一入口。
- 补全 `workspace tool pack v1`，覆盖 `File + Shell + Network` 三类工作区操作，而不再停留在只读文件工具。
- 为所有当前和未来工具增加统一的 `permission checker` 边界与 `sandbox v1` 约束，避免权限判断散落在单个 tool 内部。

## 一句话定义

Stage 4 之后，runtime 通过单一 `Flat Tool Registry` 暴露完整工具面；`workspace tool pack v1` 补齐文件、命令执行和网络访问能力；所有工具在 `tool lookup + validate` 之后、真正执行之前统一经过 `permission checker`，并受基于 `workingDirectory` 的 runtime/tool-level sandbox 约束。

## 第一版边界

### v1 做什么

- 统一 runtime 的 tool 入口，明确所有已挂载和未来新增工具都走同一套 registry 准入机制
- 补齐 `workspace tool pack v1`
- 文件类工具覆盖读、列目录、搜索、写、建目录、删、移、拷
- shell 类工具提供单一命令执行入口
- network 类工具提供单一外部请求入口
- 在 runtime 中加入独立 `permission checker` 边界
- 将权限流和现有业务确认流拆开，分别建模
- 在 prompt 中明确当前挂载的是统一 tool surface，并提示哪些操作可能触发 permission pause
- 在 trace 中记录权限请求、批准、拒绝和阻断事件

### v1 不做什么

- 不做按 capability pack 动态装配 runtime 的复杂系统
- 不做 OS 级沙箱、容器隔离、独立 seccomp / namespace 方案
- 不做 network 白名单平台或成熟浏览器权限系统
- 不做 shell/network 的细粒度命令语义分析
- 不做“所有工具都审批”的超保守模式
- 不复用现有 `ask_for_confirmation` 或 `pendingConfirmationPayload` 来承载权限等待

## 总体方案

### 1. 统一入口模型

Stage 4 固定采用单一 `Flat Tool Registry` 作为 runtime 标准入口。

含义：

- runtime 最终只接收一个全局 `ToolRegistry`
- capability pack 继续保留，但只作为文档分组、实现组织和装配来源
- capability pack 不是运行时唯一入口，真正挂进 runtime 的只有全局 registry

这样做的原因：

- 现有 runtime、prompt、tool execution 都已经围绕单一 registry 工作
- 先固定统一入口，可以避免后续新增工具再次走“临时拼接”
- pack 仍然有价值，但不需要在 Stage 4 同时引入更重的动态装配系统

### 2. 新工具准入规则

未来新增 tool 只有在补齐入口声明后，才能挂载到 runtime。

第一版入口声明至少要覆盖：

- `name`
- `description`
- `family`
- `isReadOnly`
- `hasExternalSideEffect`
- `permissionProfile`
- `sandboxProfile`

其中：

- `family` 用于区分 `workspace-file`、`workspace-shell`、`workspace-network`、`schedule`
- `permissionProfile` 用于告诉 permission checker 该工具属于直通、按破坏性审批，还是总是审批
- `sandboxProfile` 用于告诉 runtime 该工具受哪类边界约束

约束：

- 未声明这些入口信息的 tool 不允许注册成功
- runtime 不允许通过工具名硬编码来长期判断权限
- 第一版可以在 registry 侧集中定义这些规则，但文档要先把契约固定下来

## workspace tool pack v1

### 工具范围

第一版固定覆盖三类能力：

#### 文件类

- `read_file`
- `list_directory`
- `search_text`
- `write_file`
- `create_directory`
- `delete_path`
- `move_path`
- `copy_path`

#### shell 类

- 单一命令执行入口

约束：

- 默认工作目录固定为 `session.workingDirectory`
- 后续可扩展更多 shell 辅助工具，但 Stage 4 先只定义单一执行入口

#### network 类

- 单一外部请求入口

约束：

- 允许 runtime 发起外部 HTTP 请求
- 是否允许执行由 permission checker 决定
- Stage 4 不承诺更细的协议级安全隔离

### 文件类工具的高风险定义

当前策略固定为 `Destructive Only for file ops`：

- 新建文件：可直通
- 新建目录：可直通
- 修改已有文件：需要审批
- 删除路径：需要审批
- 移动路径：需要审批
- 复制到已存在目标路径：需要审批
- 越出 `workingDirectory`：直接阻断，不进入审批

说明：

- 这里的“修改已有文件”包括覆盖写、追加写或任何会改动现有文件内容的行为
- 第一版不要求工具自己做复杂的文件差异语义解释，只需要能明确地区分“新建”和“修改已有文件”

### shell 与 network 的高风险定义

当前策略固定为 `Always Approval for shell/network`：

- 任意 shell 工具调用都先进入 permission checker
- 任意 network 工具调用都先进入 permission checker
- 第一版不做命令级或 URL 级自动豁免

这样做的原因：

- shell 和 network 的副作用面远高于文件类新建操作
- 在没有更成熟元数据体系之前，先统一审批最稳妥

## permission checker v1

### 插入位置

permission checker 固定插在：

1. `toolRegistry.get(...)`
2. `tool.validate(...)`
3. `permissionChecker.check(...)`
4. `tool.execute(...)`

含义：

- 未知工具先按普通错误返回
- 非法输入先按普通 validation error 返回
- 只有“工具存在且输入合法”的调用，才进入权限判断
- 被阻断或待审批的操作，不能先执行再回滚

### 决策结果

第一版至少支持三种结果：

- `allow`
- `ask_user`
- `block`

语义：

- `allow`：本轮继续执行 tool
- `ask_user`：本轮暂停，进入权限等待
- `block`：直接返回阻断结果，不进入等待，也不执行 tool

### 权限流与业务确认流分离

当前仓库已经存在一套业务型确认流：

- `waiting_for_conflict_confirmation`
- `pendingConfirmationPayload`

Stage 4 必须新增独立权限等待建模，例如：

- `waiting_for_permission`
- `pendingPermissionRequest`

要求：

- 两套状态不共用 payload
- schedule 冲突确认仍然只服务业务覆盖/冲突场景
- 通用工具权限暂停只由 permission checker 驱动
- runtime 在恢复执行时，必须能区分“用户在回复业务确认”还是“用户在回复权限请求”

### yolo / bypass 模式

第一版允许保留 `yolo` 概念，但必须收敛为明确契约，而不是模糊描述。

固定规则：

- `yolo` 只影响本来会进入 `ask_user` 的权限请求
- `block` 型规则不能被 `yolo` 绕过
- 文件越界访问仍然一律阻断
- shell / network 若未来要支持 `yolo`，也必须在文档中单独声明；Stage 4 默认不自动绕过它们的审批

换句话说，Stage 4 里的 `yolo` 不是“所有权限都失效”，而是“可审批项可跳过，硬阻断项不可跳过”。

## sandbox v1

### 定义

Stage 4 的 sandbox 固定指 `runtime/tool-level sandbox`，不是 OS 级沙箱。

### 文件边界

- 文件类工具都必须以 `workingDirectory` 为根目录做路径归一化
- 任意目标路径只要逃出 `workingDirectory`，就直接阻断
- 这个规则属于 sandbox 硬边界，不属于“可审批项”

### shell 边界

- shell 工具默认工作目录固定为 `session.workingDirectory`
- 第一版不承诺命令级静态分析或系统调用级限制
- shell 的主要安全控制先依赖“总是审批 + 工作目录固定”

### network 边界

- network 工具的主要控制方式是“总是审批”
- 第一版不承诺实现进程级网络封禁、域名白名单或代理层强约束

## prompt 与 trace

### prompt

Stage 4 需要在 prompt 中补充以下语义：

- 当前 runtime 暴露的是统一 tool surface，而不是零散工具
- 只能调用当前工具列表里真正挂载的工具
- 某些操作会触发 permission pause
- 若工具因为 sandbox 或 permission 被阻断，应换一种安全路径，而不是重复提交同一个高风险调用

建议保留的提示方向：

- 文件类创建操作通常可直接执行
- 文件覆盖、删除、移动、shell、network 可能触发审批
- 越出工作区的访问不会被允许

### trace

第一版至少新增以下权限事件：

- `permission_request`
- `permission_approved`
- `permission_rejected`
- `permission_blocked`

trace 至少要能回答：

- 本轮哪个 tool 触发了权限判断
- 是进入审批还是被直接阻断
- 用户是否批准
- 批准后恢复执行的是哪一个原始 tool call

## 模块落点建议

### `packages/agent/src/tools/`

- 扩展 `RuntimeTool` 契约
- 为文件、shell、network、schedule 工具补齐统一入口元数据
- registry 在注册时校验工具声明是否完整

### `packages/agent/src/runtime/`

- 新增独立 `permission-checker` 边界
- 在 tool execution 里插入统一权限判断
- 新增权限暂停、恢复与阻断逻辑

### `packages/domain/`

- 为 session context 增加权限等待状态与 payload 类型
- 明确与现有业务确认流并存，而不是合并

### `packages/agent/src/prompt.ts`

- 更新默认 prompt 语义
- 让模型理解统一 tool surface 与权限暂停语义

### `packages/agent/src/trace.ts`

- 增加权限相关 trace event 定义

### `apps/api/src/index.ts`

- 文档层面改成“从统一 registry 入口装配默认工具面”
- 默认工具面应能纳入当前已有工具以及未来新增工具，而不是继续写成只挂 schedule tools

## 建议实现步骤

1. 先扩展工具入口契约

- 在 `RuntimeTool` 层补齐统一入口元数据
- 明确 registry 注册时的必填项

2. 补齐 workspace tool pack

- 在现有只读文件工具基础上，补文件写操作
- 增加单一 shell 入口
- 增加单一 network 入口

3. 固化统一 registry 装配

- 继续保留 capability pack 概念
- 但最终都汇总到一个 `Flat Tool Registry`
- 默认 runtime 装配从这个统一入口生成

4. 插入 permission checker

- 放在 tool lookup + validate 之后
- 先只做 `allow / ask_user / block`
- 文件类按 `Destructive Only`
- shell / network 按 `Always Approval`

5. 拆开权限流与业务确认流

- 新增独立 session 状态和 payload
- 不能复用现有 schedule confirmation 结构

6. 更新 prompt 与 trace

- prompt 说明统一工具面和权限暂停语义
- trace 记录 request / approved / rejected / blocked

## 验收标准

- 统一 registry 能同时表达 `workspace-file`、`workspace-shell`、`workspace-network`、`schedule` 工具入口
- 新增 tool 若缺少入口元数据，注册阶段直接失败
- 新建文件不触发审批，可直接执行
- 新建目录不触发审批，可直接执行
- 对已存在文件执行写操作时，会进入权限等待
- `delete_path` 会进入权限等待
- `move_path` 会进入权限等待
- `copy_path` 在目标已存在时会进入权限等待
- shell 工具总是进入权限等待
- network 工具总是进入权限等待
- 任意文件路径越出 `workingDirectory` 时直接阻断，不进入审批
- 权限拒绝后不产生副作用
- 权限批准后恢复原始 tool call，并继续 loop
- 现有 schedule 冲突确认流不受影响
- prompt 能表达统一工具面和权限暂停语义
- trace 能回放完整的权限判断过程

## 默认假设

- `Flat Tool Registry` 是后续 runtime 的唯一标准入口
- capability pack 继续保留，但只作为组织和分组概念
- `workspace tool pack v1` 固定包含 `File + Shell + Network`
- 文件类权限策略固定为 `Destructive Only`
- shell / network 权限策略固定为 `Always Approval`
- `sandbox v1` 只承诺 runtime/tool 边界，不承诺 OS 级隔离
