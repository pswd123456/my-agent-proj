# Stage 1: foundational runtime sketch

## 文档状态

这份文档保留最早的 runtime 草稿，用来记录第一阶段真正想搭起来的最小骨架。它不是当前实现的事实源，当前现状请看：

- `packages/agent/src/`
- `apps/api/src/`
- `packages/domain/src/session-settings.ts`

## 当时想解决的问题

第一阶段的目标很简单：先把一个可执行、可恢复、可扩展的 agent loop 立起来，再谈更复杂的 provider、skills、permission 和 capability pack。

## 核心骨架

### 1. Agent loop

最小循环是：

`prompt -> model -> tool call -> tool result -> next turn -> final`

当时希望 runtime 至少能表达这些状态：

- `running`
- `interrupted`
- `idle`
- `completed`
- `waiting_for_input`
- `waiting_for_tool_result`
- `failed`

### 2. Prompt builder

最早就明确要把 prompt 拆成稳定部分和动态部分：

- `system prompt`
- 稳定前缀
- runtime context
- `workingDirectory`
- `messages`
- `tool schema`

核心意图是让不常变化的内容更适合缓存，而不是把所有信息每轮混成一坨。

### 3. Messages

最小消息模型当时就不是纯文本数组，而是 conversation block：

- `user`
- `assistant`
- `tool_call`
- `tool_result`

这个判断后来延续到了真正的多块消息和 trace 建模。

### 4. Session manager

最早定义的 session 责任包括：

- `snapshot`
- 全量 messages
- session state
- input token count
- session recovery

### 5. Tool registry

第一阶段希望工具面至少具备：

- `list tool`
- `get tool by name`
- `register tool`

### 6. Base tool

每个工具最少应有：

- `name`
- `description`
- `execute`
- `isReadOnly`

### 7. Tool state

最小工具执行状态：

- `pending`
- `success`
- `failed`

## 这份草稿后来沉淀成了什么

- loop、prompt、session、trace 的实现进入 `packages/agent/src/`
- API 入口与恢复接口进入 `apps/api/src/app.ts`
- 更完整的规格在 `stage2.md` 到 `stage5.md`

所以这份文档现在更适合被当作“设计起点”，而不是“实现说明”。
