# 架构图

这份文档用 Mermaid 描述当前仓库已经落地的系统结构，以及一次 session 执行时的主要数据流。

## 系统组件图

```mermaid
flowchart LR
  user["用户"]
  telegram["Telegram / external chat"]

  subgraph apps["apps"]
    web["apps/web
    Next.js workbench"]
    api["apps/api
    Hono API"]
    worker["apps/worker
    background task worker"]
    gateway["apps/gateway
    external channel gateway"]
  end

  subgraph packages["packages"]
    sdk["packages/sdk
    API client + shared types"]
    agent["packages/agent
    runtime + prompt + tools + session + models + skills + MCP + LSP + channels + background tasks + delegation + trace"]
    db["packages/db
    schema + migrations + sessions + routines + cron jobs + inbox + background task repositories + db client"]
    domain["packages/domain
    routine + session settings + session context + permission rules + cron job + inbox + background task + delegate types"]
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
  deepseek["DeepSeek
  Anthropic-compatible API"]
  trace["tmp/agent-sessions/sessions/*.trace.jsonl"]
  logs["tmp/agent-sessions/logs/system.log.jsonl*"]

  user --> web
  telegram --> gateway
  web --> ui
  web --> patterns
  web --> tokens
  web --> sdk
  sdk --> api
  api --> agent
  api --> db
  gateway --> api
  gateway --> db
  worker --> agent
  worker --> db
  agent --> domain
  agent --> db
  db --> postgres
  agent --> minimax
  agent --> deepseek
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
  participant Settings as SettingsConfigStore(TOML)
  participant Session as SessionManager(Postgres)
  participant Runtime as AgentRuntime
  participant Skills as WorkspaceSkills
  participant Prompt as PromptBuilder
  participant Permission as PermissionChecker
  participant Model as Anthropic-compatible model API
  participant Tools as ToolRegistry
  participant Repo as RoutineRepository
  participant Trace as Trace JSONL

  User->>Web: 输入自然语言请求
  Web->>SDK: createSession / executeSession / streamSessionExecution
  SDK->>API: POST /sessions or /sessions/:sessionId/execute(/stream)
  API->>Settings: read / update global and workspace settings
  Settings-->>API: effective session defaults
  API->>Session: 读取或创建 session
  API->>Trace: 记录 mcp_loaded pre-run event
  API->>Runtime: runtime.run(sessionId, message)
  Runtime->>Skills: discover .agents/skills/ from session.workingDirectory
  Skills-->>Runtime: skill metadata + diagnostics
  Runtime->>Prompt: build(system + prefix + runtime context + skills)
  Prompt-->>Runtime: prompt envelope
  Runtime->>Trace: 记录 skills_loaded / context_hooks_loaded / workspace_instructions_loaded / turn_start / prompt
  Runtime->>Model: 发送 system + prefix + messages + tools
  Model-->>Runtime: text / thinking / tool_use
  Runtime->>Trace: 记录 response / thinking / assistant_text / tool_call
  alt 需要调用工具
    Runtime->>Permission: 先做 permission / sandbox 判断
    Permission-->>Runtime: allow / ask / deny
    Runtime->>Tools: 按顺序执行已放行的 tool
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

## 后台任务链路

```mermaid
sequenceDiagram
  participant API as apps/api
  participant Worker as apps/worker
  participant Cron as cron_jobs
  participant Task as background_tasks
  participant Session as child session
  participant Runtime as AgentRuntime
  participant Delegate as delegation service

  Worker->>Cron: dispatchNextDueCronJob
  Cron->>Session: create cron session
  Cron->>Task: enqueue cron_job task
  API->>Task: enqueue subagent task
  Worker->>Task: claimNextTask / heartbeatTask
  Worker->>Session: load child session
  Worker->>Runtime: run(childSessionId, message)
  Runtime->>Delegate: 发起 delegated subagent 或回填结果
  Runtime-->>Worker: RunSessionResult
  Worker->>Task: complete / fail / waiting state
```

## 读图提示

- `apps/api` 是当前运行主入口，负责把各层装配起来
- `apps/worker` 负责 cron job dispatch，以及 detached background task 的轮询、认领和执行
- `apps/gateway` 负责 Telegram polling 这类常驻外部接入，再把 update 转发给 API webhook
- `packages/agent` 是执行核心，既包含 runtime loop，也包含 prompt、session、skills、MCP、LSP、channels、tools 和 trace
- `packages/ui-patterns`、`packages/ui` 和 `packages/tokens` 是 `apps/web` 的共享视觉与布局层
- tool 执行前还有独立的 permission checker；待批准请求和业务确认流是分开建模的
- `PostgreSQL` 保存 session、routine、cron job、inbox binding 与 background task 数据，`tmp/` 主要保存 trace 与 system logs
- `SettingsConfigStore` 统一读取 `~/.agents/config.toml` 与 workspace `.agents/config.toml`，提供单租户 session settings
