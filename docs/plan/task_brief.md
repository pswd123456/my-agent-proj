# Task Brief

更新时间：2026-04-26
状态：`plan mode` v1 已落地；runtime `full compaction` 已落地，但仍与 `task brief` 解耦
范围：当前 `task brief` artifact、prompt 消费方式、工具面边界，以及后续可演进方向

## 这份文档现在描述什么

这份文档不再把 `task brief` 视为一份纯未来设计稿，而是同时说明两层内容：

1. 当前仓库已经落地的 `task brief` 行为
2. 后续如果要把它继续扩展到 `full compaction`，边界应该放在哪里

判断当前运行事实时，优先以这些实现为准：

- `packages/agent/src/session/task-brief.ts`
- `packages/agent/src/prompt.ts`
- `packages/agent/src/tools/get-task-brief.ts`
- `packages/agent/src/tools/replace-task-brief.ts`
- `packages/agent/src/runtime/permission-checker.ts`
- `docs/architecture/context-management/plan-mode.md`

## 当前定位

当前实现里，`task brief` 是一份 session 级 planning artifact，用来给 agent 提供一份短的任务骨架。

它是：

- `plan mode` 的配套 artifact
- `todoState` 之外的一份任务骨架
- 当前通过 planning tool surface 显式维护的 session 级 artifact

它不是：

- 通用长期 memory
- 默认对所有 session 强制维护的大状态
- 当前已经结构化持久化到 `session.context.taskBrief` 的对象
- 已经接入 `full compaction` 的 continuation state

一句话说，当前的 `task brief` 更接近“工作区里的 planning markdown artifact”，而不是“结构化 working memory”。

## 当前已落地实现

### 1. 主事实源是工作区 markdown 文件

当前 `task brief` 的主事实源不是结构化 session state，而是工作区里的 markdown 文件：

```text
<session.workingDirectory>/
  .agent/
    plans/
      <sessionId>/
        <planName>.md
```

当前 session context 里只保存两个相关字段：

- `planModeEnabled: boolean`
- `taskBriefPath: string | null`

也就是说，数据库和 session snapshot 持久化的是“是否处于 plan mode”和“brief 绑定路径”，不是一份结构化 `taskBrief` 对象。

### 2. 开启 plan mode 时会绑定 brief 路径

当 session 创建时或通过 session settings 打开 `plan mode` 时，runtime 会为当前 session 绑定默认 brief 路径。

当前行为是：

- 如果 session 还没有 `taskBriefPath`，则首次调用 `replace_task_brief` 时需要显式提供 `plan_name`，然后绑定 `.agent/plans/<sessionId>/<planName>.md`
- `planName` 由模型在生成计划时填写，例如 `jump_joy_web_game.md`
- 绑定路径本身会进入 session state
- 开启 `plan mode` 的瞬间不会自动写入 brief 文件正文

对旧 session 遗留的 legacy flat path 还保留一条兼容分支：

- `.agent/plans/<sessionId>.md` 仍被视为有效旧绑定
- 如果 legacy 文件缺失，则下一次 `replace_task_brief` 必须补 `plan_name`，runtime 会升级到新的命名路径
- 如果 legacy 文件已存在，不带 `plan_name` 仍可覆盖旧文件，但新的命名路径仍然是推荐形态

因此，`taskBriefPath` 的存在不等于 brief 文件一定已经创建。

### 3. prompt 不再重复注入 brief 正文

当前 prompt builder 不再把 `taskBriefPath` 指向文件的正文直接注入 `runtimeContextMessages`。

当前保留在 `runtimeContextMessages` 的只有控制信息：

- `Plan mode: enabled|disabled`
- `Task brief path`
- `Task brief binding`
- `Task brief next write`

这里有两个很重要的现状：

1. `task brief` 正文不进入 stable prefix，也不再重复进入 `runtimeContextMessages`
2. brief 正文当前主要通过 `replace_task_brief` / `get_task_brief` 的 tool result 回放被模型消费
3. brief 内容变化不会进入 `cacheKey`

因此，当前的 brief 更像“通过 planning 工具显式读写的 artifact”，而不是“每轮自动回灌的运行时上下文”。

### 4. 退出 plan mode 后，brief 不会再被自动重复注入

当前实现里，关闭 `plan mode` 时：

- 普通 workspace 文件写工具恢复原有权限逻辑
- `taskBriefPath` 仍然保留
- runtime 不会自动删除或重置 brief 文件

这意味着退出 `plan mode` 后，当前也不存在一条“把 brief 转成别的结构化执行态”的额外消费链路。

实际行为是：

- session 继续保留 `taskBriefPath`
- prompt 仍会保留 `Plan mode: disabled` 与 brief 绑定控制信息
- 但不会再把当前 brief 正文自动拼回 `runtimeContextMessages`

所以，当前并没有“退出后自动继续消费 brief 正文”的机制；后续如果需要这条能力，应单独设计，而不是继续往 runtime context 里塞同一份内容。

### 5. 当前工具面是 `get` / `replace`，不是结构化 update

当前 planning tool surface 已落地的是：

- `get_task_brief`
- `replace_task_brief`

其中：

- `get_task_brief` 只读，返回 `path / exists / content / truncated`
- `replace_task_brief` 是当前唯一允许写 brief 的入口
- `replace_task_brief` 成功后会返回路径和当前写入内容；当前模型主要通过这类 tool result 回放拿到最新 brief 正文
- 如果需要在后续轮次重新读取完整 markdown 内容，应显式调用 `get_task_brief`
- 第一次写 brief 时，`replace_task_brief` 必须带 `plan_name`
- `replace_task_brief` 只允许写当前 session 绑定的 brief 路径
- 写 brief 只能通过 `replace_task_brief`，不要用 shell 重定向或普通 workspace file 工具写入
- 必要时会自动创建 `.agent/plans/<sessionId>/`
- 如果 session 仍在 legacy flat 绑定且文件缺失，`replace_task_brief` 会要求先提供 `plan_name`，再把绑定升级到命名路径

当前并没有落地结构化 `update_task_brief` 聚合工具，也没有 section 级工具。

### 6. 当前 plan mode 只拦普通 workspace 文件写工具

当 `planModeEnabled = true` 时：

- prompt 暴露给模型的工具列表会隐藏普通 `workspace-file` 写工具
- 普通 `workspace-file` 写工具会在权限检查前被直接 block
- `planning` family 工具仍然可用
- `task brief` 写入只能通过 `replace_task_brief`，不能用 shell 重定向绕过

当前被 `plan mode` 拦截的是“普通工作区文件改动”，不是所有 mutating tool 的总开关。

这条边界的意义是：

- 让“维护 task brief artifact”和“修改普通工作区文件”分开
- planning 阶段可以继续读文件、看 git、维护 todo 和 brief
- 但不能直接改业务文件
- 即使旧消息或异常 tool call 仍然带上普通写工具，权限层也会继续 block，作为 prompt 侧隐藏之外的兜底保护

## 与 todoState 的当前分工

当前仓库里，`todoState` 和 `task brief` 是两层不同的 planning 信息：

### `todoState`

负责：

- 当前任务拆分
- active item
- 步骤状态流转

更适合回答：

- 现在做哪一步
- 哪一步完成了
- 哪一步被取消了

### `task brief`

负责：

- 目标
- 约束
- 验收标准
- 已验证事实
- 决策
- checkpoint 锚点

更适合回答：

- 这次任务到底要交付什么
- 哪些前提已经确认
- 为什么当前计划成立
- 中断后应该从什么认知状态继续

当前这两者没有做结构化双写同步，brief 正文仍以 markdown 文件为事实源。

## 为什么当前不做成通用 working memory

如果把 `task brief` 扩展成任何长任务都默认维护的一份通用 memory，会有几个明显问题：

1. 状态过重
   - 普通任务不需要额外维护一套丰富 planning state
   - 会把 planning 负担扩散到所有 session

2. 与 `todoState` 重叠
   - 很多“当前步骤”类信息会重复
   - 模型会在 todo 和 memory 之间摇摆

3. 与现有 compact 边界冲突
   - 仓库当前默认机制仍是 `history compact`
   - 如果再引入常驻大状态，context 设计会重新膨胀

因此当前更合适的定位仍然是：一份窄的 planning artifact，而不是另一套泛化 memory。

## 当前不做的事

截至现在，`task brief` 相关能力明确还没有做这些事：

- 结构化 `session.context.taskBrief`
- `update_task_brief` 聚合工具
- section 级碎工具，例如 `append_task_brief_fact`
- 退出 `plan mode` 时把 brief 自动转入新的执行态结构
- `full compaction` 对 brief 的直接消费
- 自动从完整历史抽取 brief
- 普通执行态每轮强制维护 brief

## 后续可演进方向

当前实现已经够支撑 `plan mode` v1，但如果后续继续演进，比较自然的方向是下面两条。

### 方向 1：继续保持文件型 artifact，只增强写入 surface

这条路线最保守：

- 继续以 markdown 文件作为主事实源
- 仍然通过 planning family 工具维护
- 在需要时增加更强约束的 brief 写工具

适用场景：

- 继续强调“用户可直接打开和编辑”
- 优先维持当前工具显式读取/写入方式
- 不急着引入新的结构化持久化复杂度

### 方向 2：为 full compaction 补一层结构化骨架

如果未来 `full compaction` 真的要消费 `task brief`，更合理的做法也不是直接把当前 markdown 文件当作完整状态机，而是增加一层窄的结构化骨架，例如：

```ts
type SessionTaskBrief = {
  goal: string | null;
  acceptanceCriteria: string[];
  constraints: string[];
  keyFacts: Array<{
    id: string;
    summary: string;
    evidence?: string;
  }>;
  decisions: Array<{
    id: string;
    summary: string;
    rationale?: string;
  }>;
  nextCheckpoint: string | null;
  lastUpdatedAt: string | null;
};
```

但这一步只有在下面两个前提同时成立时才值得做：

- `full compaction` 已经明确需要稳定模板输入
- markdown-only 方案已经不能满足恢复质量

也就是说，结构化 `task brief` 是可能的后续阶段，不是当前实现事实。

## 和 full compaction 的关系

当前可以先明确一条边界：

- `task brief` 未来可以成为 `full compaction` 的输入之一
- 但当前仓库还没有落这条链路

后续如果做这部分，应该单独回答这些问题：

- compact 何时触发
- brief 如何参与 compact 模板
- compact 后 continuation brief 是否需要持久化
- compact 前后的 trace 和 session 恢复如何对齐

在这些问题没有落地前，不要把当前 brief artifact 描述成已经承担 `full compaction` 状态职责。

## 当前验收口径

如果只按现在已落地实现来描述，`task brief` 的验收口径应该是：

1. `task brief` 是 session 级 planning artifact，不是通用 memory
2. 当前主事实源是工作区 markdown 文件，不是结构化 `session.context.taskBrief`
3. brief 正文不会再重复进入 `runtimeContextMessages`，也不进入 cache key
4. 开启 `plan mode` 时不会自动绑定 brief 路径；第一次写 brief 时必须显式给出 `plan_name`
5. 关闭 `plan mode` 后仍会保留 brief 绑定控制信息，但不会继续自动注入 brief 正文
6. 当前写 brief 只能通过 `replace_task_brief`，不是普通 workspace 文件写工具
