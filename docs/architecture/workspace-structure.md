# 工作目录与模块分层

## 目录骨架

```text
<project-root>/
  apps/
    api/
    web/
  packages/
    agent/
    db/
    domain/
    sdk/
    tokens/
    ui-patterns/
    ui/
  docs/
    architecture/
    design-system/
    plan/
    template/
  scripts/
  data/
  artifacts/
  tmp/
```

## 目录职责

### `apps/`

- 放具体应用与部署单元
- `api` 是当前主入口，负责 session 生命周期、执行触发、SSE 输出、trace / system log 查询、用户 settings 读取与归一化、interrupt、snapshot / recover，以及已落地的 routine 相关接口
- `web` 是当前唯一产品层前端，主要承担工作台和调试可观测性；它消费 `packages/tokens`、`packages/ui-patterns` 和 `packages/ui`
- agent session 的默认工作目录不再直接落在 repo root，而是 repo 根下的 `agent-workspace/`
- `apps/worker/` 当前仅作为残留目录存在；它没有进入 workspace 启动链路，也不应被表述为已启用应用

### `packages/`

- 放跨应用复用的共享能力
- `agent` 放 runtime、prompt、provider 适配、session 抽象、skills、tools 和 trace
- `db` 放数据库连接、schema 初始化、settings repository、session 持久化配套和 routine repository
- `domain` 放日程、session context、session settings 和权限规则等纯领域模型
- `sdk` 放 API client、会话摘要转换和跨层类型导出
- `tokens` 放设计 token
- `ui-patterns` 放工作台、页面骨架等可复用模式
- `ui` 放更细粒度的基础 UI 组件

### `docs/`

- `architecture/` 放架构边界、技术栈、目录分层和架构图
- `design-system/` 放 UI 一致性、模式和 token 约定
- `plan/` 放阶段性设计与执行文档
- `template/` 放模板初始化和裁剪规则

### `scripts/`

- 放 smoke、调试和开发期辅助脚本

### `data/`

- 放输入数据或样例数据

### `artifacts/`

- 放生成结果、导出文件和需要保留的非源码产物
- 当前仓库还未形成稳定产物目录时，可以先按需创建

### `tmp/`

- 放临时文件、中间产物和可观测性输出
- 当前 trace 文件默认在 `tmp/agent-sessions/sessions/<sessionId>.trace.jsonl`；system log 默认在 `tmp/agent-sessions/logs/system.log.jsonl`，按大小轮转

## 放置原则

- 应用壳层逻辑留在 `apps/`，不要把 runtime、领域规则或数据库访问反向塞回 app
- 可跨端复用的能力优先沉淀到 `packages/`
- session settings 的解析顺序是 `explicit override > user settings > repo default`；repo default 当前固定为 `agent-workspace/`
- 工作区 skills 统一放在 session workingDirectory 下的 `.agent/skills/`
- 文档中应显式区分“当前已实现”和“后续预留”，避免模板期说法长期漂移
- 构建产物和运行中间文件不应作为架构事实来源；源代码与文档才是长期权威
- 当前 workspace 包名前缀仍为 `@ai-app-template/*`，新增代码时应先遵守现有 import 边界，再决定是否统一重命名
