# 工作目录与模块分层

## 目录骨架

```text
<project-root>/
  apps/
    web/
    api/
    worker/
  packages/
    domain/
    db/
    agent/
    sdk/
    ui/
    tokens/
    ui-patterns/
  docs/
    architecture/
    design-system/
    template/
  scripts/
  data/
  artifacts/
  tmp/
```

## 目录职责

### `apps/`

- 放具体应用与部署单元
- `web` 负责 Web MVP
- `api` 负责对外 API 与应用层编排
- `worker` 负责异步任务、调度与后台 agent 执行

### `packages/`

- 放跨应用复用的共享能力
- `domain` 放领域模型与业务规则
- `db` 放数据库 schema、迁移与持久化访问
- `agent` 放 `LangGraph` 工作流、状态、工具与 prompts
- `sdk` 放跨端 API 客户端与契约封装
- `ui` 放基础组件与通用业务组件
- `tokens` 放设计 tokens 与主题映射
- `ui-patterns` 放页面模板与高频结构模式

### `docs/`

- 放长期有效的约定、决策、流程说明与规则

### `scripts/`

- 放通用工程脚本

### `data/`

- 放输入数据或样例数据

### `artifacts/`

- 放生成结果与构建外产物

### `tmp/`

- 放临时文件与中间产物

## 放置原则

- 应用专属逻辑留在 `apps/`
- 共享能力优先沉淀到 `packages/`
- 规则与决策优先沉淀到 `docs/`
- 不要把脚本、数据和生成产物直接堆到仓库根目录
