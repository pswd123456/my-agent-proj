# 架构图

这份文档用 Mermaid 描述当前仓库已经落地的系统结构，以及一次 session 执行时的主要数据流。

## 系统组件图

```mermaid
flowchart LR
  user["用户"]

  subgraph apps["apps"]
    web["apps/web
    Next.js workbench"]
    api["apps/api
    Hono API"]
    worker["apps/worker
    recovery worker
    current built artifact"]
  end

  subgraph packages["packages"]
    sdk["packages/sdk
    API client + shared types"]
    agent["packages/agent
    runtime + prompt + tools + session + trace"]
    db["packages/db
    schema + repository + db client"]
    domain["packages/domain
    routine + session context"]
    ui["packages/ui + ui-patterns + tokens
    reusable UI layer"]
  end

  postgres[("PostgreSQL")]
  minimax["MiniMax
  Anthropic-compatible API"]
  trace["tmp/agent-sessions/sessions/*.trace.jsonl"]

  user --> web
  web --> ui
  web --> sdk
  sdk --> api
  api --> agent
  api --> db
  agent --> domain
  agent --> db
  db --> postgres
  agent --> minimax
  agent --> trace
  worker --> agent
  worker --> db
```

## 一次 session 的执行链路

```mermaid
sequenceDiagram
  participant User as 用户
  participant Web as apps/web
  participant SDK as packages/sdk
  participant API as apps/api
  participant Session as SessionManager(Postgres)
  participant Runtime as AgentRuntime
  participant Model as MiniMax API
  participant Tools as ToolRegistry
  participant Repo as RoutineRepository
  participant Trace as Trace JSONL

  User->>Web: 输入自然语言请求
  Web->>SDK: createSession / executeSession / streamSessionExecution
  SDK->>API: POST /sessions or /execute/stream
  API->>Session: 读取或创建 session
  API->>Runtime: runtime.run(sessionId, message)
  Runtime->>Trace: 记录 turn_start / prompt
  Runtime->>Model: 发送 system + prefix + messages + tools
  Model-->>Runtime: text / thinking / tool_use
  Runtime->>Trace: 记录 response / thinking / assistant_text / tool_call
  alt 需要调用工具
    Runtime->>Tools: 按顺序执行 tool
    Tools->>Repo: 读写 routines 或查询数据
    Repo-->>Tools: repository result
    Tools-->>Runtime: tool_result
    Runtime->>Trace: 记录 tool_result
    Runtime->>Model: 继续下一轮
  else 直接完成
    Runtime->>Session: 保存最终消息与状态
  end
  Runtime-->>API: RunSessionResult / stream events
  API-->>SDK: JSON 或 SSE
  SDK-->>Web: 会话结果、流式事件、trace
  Web-->>User: 展示对话、thinking、tools、prompt、trace
```

## 读图提示

- `apps/api` 是当前运行主入口，负责把各层装配起来
- `packages/agent` 是执行核心，既包含 runtime loop，也包含 prompt、session、tools 和 trace
- `PostgreSQL` 保存 session 与 routine 数据，`tmp/` 主要保存 trace
