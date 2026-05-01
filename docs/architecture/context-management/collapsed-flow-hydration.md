# 折叠消息块 Hydration 回归

## 定位

这份文档记录 workbench 对话区里“折叠消息块先闪一下，随后在 session hydrate 后消失”的一类回归。

它关注的是前端消息投影层，而不是 runtime 是否真的少写了消息。相关事实源优先看：

- `apps/web/app/_components/session-message-manager.ts`
- `apps/web/app/_components/session-conversation-view.ts`
- `apps/web/app/_components/session-timeline.ts`
- `apps/web/app/_components/session-workbench.tsx`

## 典型现象

症状通常长这样：

- 切换 session 后，先能看到一瞬间折叠块
- trace / 历史事件加载进来后，折叠块消失
- 用户体感是“闪一下再展开”或“折叠块不稳定”

这类问题不代表 session 持久化坏了，更常见的是：

- `session.messages` 单独投影时可以折叠
- `session.messages + traceRecords` 一起投影时却不能折叠

也就是说，问题发生在前端 projection 的合并和可见性判定上。

## 这次回归的根因

这次已确认的回归链路如下：

1. workbench 先拿到 `SessionSnapshot`，页面首帧基于持久化 `messages` 渲染。
2. 仅使用 `session.messages` 时，`compactFinalFlowSegment()` 会把“用户消息 -> 中间执行流 -> 最终 assistant”压成一个折叠块。
3. trace hydrate 之后，前端会用历史事件重建 timeline；原本的 persisted tool / thinking block 会被 trace event 替代。
4. `context_hooks_loaded` 被当成了可见 conversation event。
5. 某些 session 中，这个元事件的时间戳落在最终 `assistant_text` 之后，于是 `compactFinalFlowSegment()` 看到 final assistant 后面还有一个“非终态尾项”。
6. compact 条件被破坏，折叠块消失。

因此，真正的问题不是“折叠逻辑本身不会折”，而是“trace hydrate 把本来不该参与 compact 判定的元事件混进了对话时间线”。

## 为什么首帧正常、hydrate 后异常

首帧和 hydrate 后看到的是两套输入：

- 首帧主要来自 `session.messages`
- hydrate 后来自 `session.messages + traceRecords`

如果这两套输入在 message manager 里投出来的 compact 结果不一致，就会出现：

- 首帧短暂显示折叠块
- hydrated projection 把它打散
- 最终表现为一帧闪烁或折叠块消失

所以，排这类问题时，不要只盯 DOM 或动画；先确认同一个 session 的这两种 projection 是否一致。

## 这次修复的落点

修复策略是把 `context_hooks_loaded` 归回“runtime 元事件”，不再进入 conversation timeline 的可见事件集。

当前规则应保持：

- `prompt` / `response` 不进 conversation timeline
- `skills_loaded` / `workspace_instructions_loaded` / `mcp_loaded` 不进 conversation timeline
- `context_hooks_loaded` 也不进 conversation timeline

这些事件可以继续保留在 trace / inspector 里用于诊断，但不应该参与：

- 对话叙事顺序
- compact 折叠判定
- “final assistant 后面是否还有尾项”的判断

## 以后改动时要注意什么

### 1. 不要把 runtime 元事件直接暴露给 compact 会话视图

只要某个 trace event 主要服务于诊断，而不是用户要看的会话叙事，就默认不应进入 compact conversation timeline。

尤其要小心这些事件：

- `context_hooks_loaded`
- `skills_loaded`
- `workspace_instructions_loaded`
- `mcp_loaded`
- 其他将来新增的加载类 / 诊断类事件

### 2. 改可见性规则时，要同时看两种 projection

只看单测里的人造 timeline 不够。至少要同时确认：

- `session.messages` 单独投影
- `session.messages + traceRecords` 一起投影

如果两者对同一段历史给出不同的 compact 结果，真实 UI 很容易再次出现首帧闪烁。

### 3. 折叠判定要基于叙事项，不要被诊断尾项污染

`compactFinalFlowSegment()` 的语义是：

- 找到用户消息
- 找到最终 assistant
- 判断它们之间的执行流是否可以折叠

如果 final assistant 后面混入了本不该可见的诊断尾项，compact 就会被误判。因此后续若新增 trace event，先判断它是不是“叙事事件”，再决定要不要进入 timeline。

### 4. 排查时优先复现同一个 session 的投影差异

这类问题最有效的排查方式不是先猜滚动或动画，而是直接比较：

- `buildMessageManagerProjection({ session, traceRecords: [] ... })`
- `buildMessageManagerProjection({ session, traceRecords, ... })`

如果前者有 `compact-collapsed-flow`，后者没有，问题基本就锁定在 trace 可见性、排序或 compact 条件上。

## 建议的回归检查

改动以下任一层时，都应回归这类问题：

- `isVisibleTimelineEvent()`
- `buildTimelineItems()`
- `buildNarrativePhaseByKey()`
- `compactFinalFlowSegment()`
- message manager 的 hydrated / stream overlay 合并逻辑

最低回归集：

```bash
bun test apps/web/app/_components/session-message-manager.test.ts apps/web/app/_components/session-timeline.test.ts
```

如果这次改动碰到了真实 hydrate 路径，再补看一次：

- 切换已有 session 时是否先折叠、后展开
- 同一个 session 的 hydrated projection 里是否仍然存在 `compact-collapsed-flow`

## 当前相关测试

- `apps/web/app/_components/session-timeline.test.ts`
  - 验证 workspace / context 类加载事件不会进入 conversation timeline
- `apps/web/app/_components/session-message-manager.test.ts`
  - 验证 hydrated trace 中即使 final assistant 后面跟着 `context_hooks_loaded`，折叠块也不会消失

## 一句话原则

折叠消息块是“会话叙事视图”，不是“完整 trace 事件列表”。凡是只服务诊断的 runtime 元事件，都不应让它参与 compact 折叠判定。
