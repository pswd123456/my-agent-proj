# API 与 SDK 边界

## 定位

这一层负责把浏览器侧的 workbench 操作，转换成稳定的 HTTP / SSE 契约，再把 runtime、session、settings、trace、workspace 辅助能力装配成可调用服务。

当前边界分四层：

- `apps/api`：服务端入口与运行时装配
- `apps/gateway`：常驻外部接入入口，主动拉取或订阅外部事件后转交 API
- `packages/sdk`：给 Web 用的类型化客户端与少量展示友好投影
- `apps/web`：通过 SDK 调 API，不直接操作数据库或 runtime

这份文档关注“契约边界”和“模块职责”，不替代具体接口代码。判断真实接口时，仍以 `apps/api/src/app.ts`、它注册的 `apps/api/src/*-routes.ts` 和 `packages/sdk/src/client.ts` 为准。

## 模块分层

### `apps/api`

`apps/api` 不是业务规则层，而是当前运行主入口与 HTTP 壳层。它主要做四件事：

1. 连接 API 进程级依赖，并把共享 runtime assembly 产出的 session/settings/trace/log 能力暴露给 HTTP 层
2. 暴露 session / settings / trace / routines / cron jobs / inbox adapter / workspace helper 接口
3. 负责 request/response schema 校验与错误映射
4. 在每次 runtime 创建前注入工作区输入、MCP 工具和 model service

关键文件：

- `apps/api/src/index.ts`：API 进程入口
- `apps/api/src/app.ts`：Hono app 创建、公共 middleware、错误映射与路由注册
- `apps/api/src/sessions-routes.ts`：session 生命周期、执行、fork / rewrite、workspace helper
- `apps/api/src/settings-routes.ts`：全局 settings、workspace MCP / channels / skills 配置视图
- `apps/api/src/telegram-routes.ts`：Telegram inbox / webhook adapter
- `apps/api/src/observability-routes.ts`：trace、system log、routine inspect / reset
- `apps/api/src/working-directory.ts`：默认工作目录解析
- `apps/api/src/directory-picker.ts`：系统目录选择器桥接
- `apps/api/src/session-relations.ts`：子会话父子关系补全
- `packages/agent/src/runtime/assembly.ts`：API / worker 共用的 runtime 装配

### `packages/sdk`

`packages/sdk` 不是通用状态管理库，而是浏览器到 API 的薄客户端层：

- 封装 fetch 调用、错误解包、SSE 事件流解析
- 暴露给前端稳定使用的 payload 类型
- 提供 `toSessionSummary()` 这类展示友好的摘要投影
- 复用 `agent` / `domain` 暴露的共享类型，避免 Web 自己猜结构

关键文件：

- `packages/sdk/src/client.ts`
- `packages/sdk/src/index.ts`

## 当前接口族

从职责上看，`apps/api` 当前接口可以分成六组：

### 1. 目录与模型元信息

- `GET /`
- `GET /health`
- `GET /models`
- `POST /directory-picker`

这组接口不直接触发 runtime 执行，主要服务于 workbench 初始化和设置面板。

### 2. 单租户默认设置

- `GET /settings`
- `PATCH /settings`
- `GET /settings/channels`
- `PUT /settings/channels`
- `GET /settings/mcp`
- `PUT /settings/mcp`
- `GET /settings/skills`
- `GET /cron-jobs`
- `POST /cron-jobs`
- `PATCH /cron-jobs/:cronJobId`
- `DELETE /cron-jobs/:cronJobId`

这组接口以单租户 settings TOML、`cron_jobs` 和当前全局默认工作目录为核心，同时暴露基于该工作目录读取或写入的 workspace 配置视图。

其中 cron job 接口负责：

- 列出当前租户的定时任务
- 创建、更新、删除定时任务定义
- 为每次调度产出的 session / background task 提供上游配置来源

统一 settings TOML 保存跨 session 复用的默认值，例如：

- `workingDirectory`
- `model`
- `thinkingEffort`
- `contextWindow`
- `maxTurns`
- shell / tool 权限规则
- `enabledCapabilityPacks`
- `workspaceSkillSettings`
- `userContextHooks`
- `debugConversationView`
- `userCustomPrompt`

其中 `/settings/mcp` 和 `/settings/channels` 读写的是当前全局默认工作目录下的 `.agents/config.toml`，`/settings/skills` 读取当前全局默认工作目录下的 `.agents/skills/`。

### 3. Session 生命周期与执行

- `GET/POST /sessions`
- `GET /sessions/search`
- `GET/PATCH/DELETE /sessions/:sessionId`
- `GET /sessions/:sessionId/fork-targets`
- `POST /sessions/:sessionId/forks`
- `POST /sessions/:sessionId/rewrite-target/recover`
- `PATCH /sessions/:sessionId/settings`
- `POST /sessions/:sessionId/execute`
- `POST /sessions/:sessionId/execute/stream`
- `POST /sessions/:sessionId/interrupt`
- `POST /sessions/:sessionId/force-stop`
- `POST /sessions/:sessionId/snapshot`
- `POST /sessions/:sessionId/recover`
- `DELETE /sessions/history`

这里的关键分工是：

- `POST /sessions`：根据 `explicit override > effective settings > repo default` 创建 session
- `GET /sessions/:sessionId/fork-targets`：返回当前可 fork 的 assistant 节点，以及最近一个可 rewrite 的用户目标
- `POST /sessions/:sessionId/forks`：从历史 checkpoint 派生一个新的 fork session
- `POST /sessions/:sessionId/rewrite-target/recover`：把当前 session 回退到最新可改写用户回合之前，供前端改写后重提
- `PATCH /sessions/:sessionId/settings`：只改当前 session 上下文，不回写用户默认值
- `execute`：一次性返回 `RunSessionResult`
- `execute/stream`：通过 SSE 按事件增量回传执行过程
- `interrupt`：单阶段中断入口，立即修复 session 可见状态并让当前 active run 观察取消；`force-stop` 仅保留为兼容入口

### 4. Workspace 辅助入口

- `GET /sessions/:sessionId/workspace-files/search`
- `GET /sessions/:sessionId/skills/search`
- `GET /sessions/:sessionId/git-status`
- `POST /sessions/:sessionId/file-changes`

这组接口服务的是 workbench 交互，不是模型工具本身：

- 搜文件和搜 skill 用于 composer / UI 辅助
- `git-status` 用于 UI 展示当前工作区文件状态
- `file-changes` 用于前端对一次 run 产生的 patch 做 `undo` / `reapply`

### 5. 可观测性与专项数据

- `GET /sessions/:sessionId/trace`
- `GET /system-logs`
- `GET /sessions/:sessionId/routines`
- `POST /sessions/:sessionId/routines/reset`

这组接口把 trace、system log、日程能力结果作为 workbench 的 inspectable data surface 暴露出来；cron job 自身的增删改查则属于上一组用户级接口。

### 6. Inbox / Telegram adapter

- `GET /inbox/telegram/status`
- `POST /inbox/telegram/set-webhook`
- `POST /inbox/telegram/webhook`

这组接口把 Telegram 私聊消息转换成 session 输入。adapter 只维护 channel chat 到 active session 的绑定、命令解析、输出模式和 update 幂等；真正的 session 创建、设置切换、interrupt 与 run 执行仍走当前 API / runtime / session manager 边界。
`apps/gateway` 在 `[channels.telegram].mode = "polling"` 时负责拉取 Bot API update，并把 update POST 到 API 的 `/inbox/telegram/webhook`；`set-webhook` 和 webhook endpoint 保留给公网 webhook 模式。API 进程自身不再启动 Telegram polling。

## 装配边界

`apps/api/src/index.ts` 负责 API 进程级 wiring，真正复用的 runtime 装配收口在 `packages/agent/src/runtime/assembly.ts`。需要主动常驻对外拉取或订阅外部事件的逻辑放在 `apps/gateway`，不要塞进 API 启动副作用。

`apps/api/src/index.ts` 主要负责：

- 解析 workspace root、默认工作目录和进程环境变量
- 选择 API 自己的目录选择器、logger 与 delegate service
- 把 `buildWorkingDirectory()`、`pickDirectory()`、`runtimeFactory()` 等进程级依赖传给 `createApiApp()`

共享 runtime assembly 负责：

- 创建 Postgres database 与 repositories
- 调 `ensureProductSchema()` 确保 schema/migrations 落地
- 创建 `createPostgresSessionManager()`
- 创建 `createPostgresCronJobRepository()` 与 `createCronJobDispatcher()`
- 创建 `createBackgroundTaskManager()`
- 创建 `createModelService(process.env)`
- 每次创建 runtime 时：
  - 读取 effective settings
  - 创建 LSP manager
  - 创建默认 tool registry
  - 读取统一 settings，其中 workspace `.agents/config.toml` 覆盖 global `~/.agents/config.toml`
  - 如果 workspace config 包含 legacy `[hooks.<id>]`，先并入 workspace hooks，再和全局 hooks 统一归一化
  - 加载 workspace MCP tools
  - 组装 trace / prompt / permission / background task 依赖

也就是说，`apps/api` 决定“这个 HTTP 进程怎样接入 runtime”，而 runtime 真正的通用装配与执行循环都不写在 `app.ts` 里。

## SDK 为什么单独存在

如果没有 `packages/sdk`，`apps/web` 会反复自己处理这些事：

- 路径字符串拼接
- JSON 错误结构解包
- SSE chunk 解析
- 会话列表与 session summary 的投影
- API 类型同步

当前 SDK 把这几件跨前端重复、但又不值得塞进页面组件里的事情收口了：

- `ensureOk()`：统一 HTTP 错误文本
- `readEventStream()`：统一 SSE 事件流解析
- `toSessionSummary()`：统一侧边栏 / rail 使用的摘要字段
- `appendCacheBust()`：对列表、详情、trace 之类轮询接口禁缓存

除此之外，SDK 还把 fork / rewrite 相关的 transport 收口成 `listSessionForkTargets()`、`createSessionFork()` 和 `recoverRewriteTarget()`，避免 `apps/web` 自己拼这些历史恢复接口。

它仍然保持“薄”，不持有全局状态，也不替代 React 侧 state manager。

fork / rewrite 的更细模块边界见 [Session Fork 与 Rewrite](./session-fork-and-rewrite.md)。

## 设计约束

### API 层应该做的事

- 请求体验证
- 组装依赖
- 维持接口契约稳定
- 把运行态错误映射成前端可处理的 HTTP / SSE 结果

### API 层不该做的事

- 在 `app.ts` 里写 runtime 领域规则
- 让 Web 直接依赖数据库结构
- 把前端展示逻辑塞进接口层
- 让单个 endpoint 偷偷绕开统一的 session / runtime / trace 边界

### SDK 层应该做的事

- 保持浏览器侧调用统一
- 复用共享类型
- 做最少量、稳定的展示友好投影

### SDK 层不该做的事

- 自己维护持久状态
- 把业务流程编排进客户端
- 自己定义一套脱离 API 的“第二份契约”

## 推荐事实源

- app 壳层与路由注册：`apps/api/src/app.ts`
- session 路由与 schema：`apps/api/src/sessions-routes.ts`
- settings 路由与 schema：`apps/api/src/settings-routes.ts`
- Telegram 路由与 schema：`apps/api/src/telegram-routes.ts`
- observability 路由：`apps/api/src/observability-routes.ts`
- runtime 装配：`packages/agent/src/runtime/assembly.ts`
- API 进程入口：`apps/api/src/index.ts`
- working directory 解析：`apps/api/src/working-directory.ts`
- session 父子关系补全：`apps/api/src/session-relations.ts`
- SDK transport：`packages/sdk/src/client.ts`
- SDK 导出面：`packages/sdk/src/index.ts`
