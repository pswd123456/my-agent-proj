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
  end

  subgraph packages["packages"]
    sdk["packages/sdk
    API client + shared types"]
    agent["packages/agent
    runtime + prompt + tools + session + trace"]
    db["packages/db
    schema + migrations + settings/routine repository + db client"]
    domain["packages/domain
    routine + session settings + session context"]
    ui["packages/ui
    base UI components"]
    patterns["packages/ui-patterns
    page frames + workbench patterns"]
    tokens["packages/tokens
    design tokens"]
  end

  postgres[("PostgreSQL")]
  minimax["MiniMax
  Anthropic-compatible API"]
  trace["tmp/agent-sessions/sessions/*.trace.jsonl"]
  logs["tmp/agent-sessions/logs/system.log.jsonl*"]

  user --> web
  web --> ui
  web --> patterns
  web --> tokens
  web --> sdk
  sdk --> api
  api --> agent
  api --> db
  agent --> domain
  agent --> db
  db --> postgres
  agent --> minimax
  agent --> trace
  agent --> logs
```

## 一次 session 的执行链路

```mermaid
sequenceDiagram
  participant User as 用户
  participant Web as apps/web
  participant SDK as packages/sdk
  participant API as apps/api
  participant Settings as SettingsRepository(Postgres)
  participant Session as SessionManager(Postgres)
  participant Runtime as AgentRuntime
  participant Skills as WorkspaceSkills
  participant Prompt as PromptBuilder
  participant Model as MiniMax API
  participant Tools as ToolRegistry
  participant Repo as RoutineRepository
  participant Trace as Trace JSONL

  User->>Web: 输入自然语言请求
  Web->>SDK: createSession / executeSession / streamSessionExecution
  SDK->>API: POST /sessions or /execute/stream
  API->>Settings: getOrCreate / update user settings
  Settings-->>API: session defaults
  API->>Session: 读取或创建 session
  API->>Runtime: runtime.run(sessionId, message)
  Runtime->>Skills: discover .agent/skills/ from session.workingDirectory
  Skills-->>Runtime: skill metadata + diagnostics
  Runtime->>Prompt: build(system + prefix + runtime context + skills)
  Prompt-->>Runtime: prompt envelope
  Runtime->>Trace: 记录 skills_loaded / turn_start / prompt
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
- `packages/agent` 是执行核心，既包含 runtime loop，也包含 prompt、session、skills、tools 和 trace
- `PostgreSQL` 保存 session 与 routine 数据，`tmp/` 主要保存 trace 与 system logs
- `settingsRepository` 保存用户级 session settings，包含工作目录、yolo、context window、max turns 和权限规则
- 本地若存在 `apps/worker/` 残留构建产物，也不应视为当前运行架构的一部分
