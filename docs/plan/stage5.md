# Stage 5: session settings + default workspace

## 文档状态

这份文档记录 Stage 5 的实现目标与当前落地结果。相关运行事实以这些文件为准：

- `packages/domain/src/session-settings.ts`
- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/working-directory.ts`
- `packages/db/src/schema.ts`

## 目标

Stage 5 主要把“每次新建 session 时临时询问的运行参数”收敛成稳定的 session settings 体系，让 runtime 在多轮执行里有明确、可持久化、可复用的默认值。

## 一句话定义

`workingDirectory`、`yoloMode`、`contextWindow`、`maxTurns` 和权限规则不再只停留在临时请求参数里，而是通过 `user settings -> session snapshot -> runtime` 这条链路注入执行上下文；repo 级默认工作区固定为根目录下的 `agent-workspace/`。

## 核心变更

### 1. 多轮执行的 context window

- 默认 `contextWindow` 为 `200000`
- 最小值通过归一化逻辑限制为 `1000`
- 当前 runtime 会先做 token budget 与 compaction 相关处理；如果预估输入仍超过上限，会在模型调用前返回 `context_window_exceeded`

### 2. settings 持久化层

- 新增 `agent_settings` 作为用户级默认配置
- 预留 `userId` 作为主键
- 当前持久化字段包括：
  - `workingDirectory`
  - `yoloMode`
  - `contextWindow`
  - `maxTurns`
  - `shellAllowPatterns`
  - `shellDenyPatterns`
  - `toolAllowList`
  - `toolAskList`
  - `toolDenyList`
  - `enabledCapabilityPacks`

### 3. session 注入顺序

当前解析顺序是：

`explicit override > user settings > repo default`

也就是说：

- 新建 session 时可显式覆盖
- 未显式覆盖时读取 `agent_settings`
- 再没有时回退到仓库默认值

### 4. 默认工作区

- repo 根目录固定保留 `agent-workspace/`
- API 会确保这个目录存在
- 留空时仍会回退到 `agent-workspace/`
- 用户传入的 `workingDirectory` 现在会按路径解析后直接生效，允许指向 repo 外目录

### 5. `maxTurns` 语义

- 默认值为 `50`
- API 允许的最大值为 `200`
- 计数语义是一次 `execute` 内的 runtime turn 数，而不是“整个 session 的历史轮数”

## 对产品层的影响

- 前端不再需要把 `cwd` / `yoloMode` 作为 session 创建前的必经弹窗
- settings 页面或对应 API 成为这类运行参数的稳定入口
- session 创建接口只负责“必要时覆盖默认值”，不再承担全部配置收集

## 当前结果

Stage 5 之后，仓库已经具备：

- 用户级 settings 持久化
- repo 默认工作区
- session 级 settings 注入
- `maxTurns` / `contextWindow` 归一化
- capability pack 默认装配

因此这份文档现在是已落地阶段规格，不再是待整理的草稿清单。
